import type { ILocationEnricher, LocationCandidate, LocationEnrichInput } from "@radar/shared";
import {
  loadNominatim429BackoffMs,
  loadNominatim429MaxBackoffMs,
  loadNominatim429MaxRetries,
  loadNominatimMinIntervalMs,
  loadNominatimUserAgent,
} from "./nominatimConfig.js";
import { extendNominatimCooldown, waitNominatimSlot } from "./nominatimRateLimit.js";

type NominatimItem = {
  display_name?: string;
  lat?: string;
  lon?: string;
};

/**
 * Геокодинг через Nominatim (OSM search).
 * Throttle: RADAR_NOMINATIM_MIN_INTERVAL_MS; 429 → экспоненциальный backoff + глобальный cooldown.
 */
export class NominatimEnricher implements ILocationEnricher {
  readonly name = "nominatim";

  constructor(
    private readonly timeoutMs = 5000,
    private readonly minIntervalMs = loadNominatimMinIntervalMs(),
    private readonly userAgent = loadNominatimUserAgent(),
    private readonly initial429BackoffMs = loadNominatim429BackoffMs(),
    private readonly max429BackoffMs = loadNominatim429MaxBackoffMs(),
    private readonly max429Retries = loadNominatim429MaxRetries(),
  ) {}

  async enrich(input: LocationEnrichInput): Promise<LocationCandidate | null> {
    const queryNorm = input.rawText.toLowerCase().trim();
    if (!queryNorm) return null;

    try {
      let backoffMs = this.initial429BackoffMs;
      for (let attempt = 0; attempt <= this.max429Retries; attempt += 1) {
        const response = await this.fetchWithThrottle(input);
        if (response.status === 429) {
          if (attempt >= this.max429Retries) {
            console.warn(
              `[nominatim] HTTP 429 — лимит retry исчерпан query=${JSON.stringify(input.rawText.slice(0, 80))}`,
            );
            return null;
          }

          const pauseMs = resolve429PauseMs(response, backoffMs, this.max429BackoffMs);
          extendNominatimCooldown(pauseMs);
          console.warn(
            `[nominatim] HTTP 429 — пауза ${pauseMs}ms (retry ${attempt + 1}/${this.max429Retries}) query=${JSON.stringify(input.rawText.slice(0, 80))}`,
          );
          await sleep(pauseMs);
          backoffMs = Math.min(backoffMs * 2, this.max429BackoffMs);
          continue;
        }

        if (!response.ok) {
          console.warn(
            `[nominatim] HTTP ${response.status} query=${JSON.stringify(input.rawText.slice(0, 80))}`,
          );
          return null;
        }

        return this.mapResponse(response, input);
      }

      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[nominatim] ${message} query=${JSON.stringify(input.rawText.slice(0, 80))}`);
      return null;
    }
  }

  private async fetchWithThrottle(input: LocationEnrichInput): Promise<Response> {
    await waitNominatimSlot(this.minIntervalMs);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchSearch(input, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  private fetchSearch(input: LocationEnrichInput, signal: AbortSignal): Promise<Response> {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", input.rawText);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("addressdetails", "0");
    if (input.countryCode) {
      url.searchParams.set("countrycodes", input.countryCode);
    }
    const viewbox = input.viewbox;
    if (viewbox) {
      url.searchParams.set(
        "viewbox",
        `${viewbox.west},${viewbox.north},${viewbox.east},${viewbox.south}`,
      );
    }
    return fetch(url, {
      headers: { "User-Agent": this.userAgent },
      signal,
    });
  }

  private async mapResponse(
    response: Response,
    input: LocationEnrichInput,
  ): Promise<LocationCandidate | null> {
    const payload = (await response.json()) as NominatimItem[];
    const best = payload[0];
    if (!best) {
      console.warn(`[nominatim] пустой ответ query=${JSON.stringify(input.rawText.slice(0, 80))}`);
      return null;
    }
    return {
      provider: this.name,
      queryNorm: input.rawText.toLowerCase(),
      regionCode: input.regionCode,
      placeName: best.display_name,
      lat: best.lat ? Number(best.lat) : undefined,
      lon: best.lon ? Number(best.lon) : undefined,
      raw: best as Record<string, unknown>,
    };
  }
}

/** Retry-After (сек) или экспоненциальный backoff; не меньше initial. */
function resolve429PauseMs(
  response: Response,
  fallbackMs: number,
  maxMs: number,
): number {
  const retryAfterSec = Number(response.headers.get("Retry-After") ?? "0");
  const fromHeader =
    Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : 0;
  return Math.min(Math.max(fromHeader, fallbackMs), maxMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
