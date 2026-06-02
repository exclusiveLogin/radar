import type { ILocationEnricher, LocationCandidate } from "@radar/shared";
import {
  loadNominatimMinIntervalMs,
  loadNominatimUserAgent,
} from "./nominatimConfig.js";
import { waitNominatimSlot } from "./nominatimRateLimit.js";

type NominatimItem = {
  display_name?: string;
  lat?: string;
  lon?: string;
};

/**
 * Геокодинг через Nominatim (OSM search).
 * Публичный инстанс: throttle через RADAR_NOMINATIM_MIN_INTERVAL_MS (default 1100 ms).
 */
export class NominatimEnricher implements ILocationEnricher {
  readonly name = "nominatim";

  constructor(
    private readonly timeoutMs = 5000,
    private readonly minIntervalMs = loadNominatimMinIntervalMs(),
    private readonly userAgent = loadNominatimUserAgent(),
  ) {}

  async enrich(input: { rawText: string; regionCode?: string }): Promise<LocationCandidate | null> {
    const queryNorm = input.rawText.toLowerCase().trim();
    if (!queryNorm) return null;

    try {
      let response = await this.fetchWithThrottle(input.rawText);
      if (response.status === 429) {
        const retryAfterSec = Number(response.headers.get("Retry-After") ?? "0");
        const backoffMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
          ? retryAfterSec * 1000
          : this.minIntervalMs * 2;
        console.warn(
          `[nominatim] HTTP 429 — пауза ${backoffMs}ms query=${JSON.stringify(input.rawText.slice(0, 80))}`,
        );
        await sleep(backoffMs);
        response = await this.fetchWithThrottle(input.rawText);
      }
      if (!response.ok) {
        console.warn(
          `[nominatim] HTTP ${response.status} query=${JSON.stringify(input.rawText.slice(0, 80))}`,
        );
        return null;
      }
      return this.mapResponse(response, input);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[nominatim] ${message} query=${JSON.stringify(input.rawText.slice(0, 80))}`);
      return null;
    }
  }

  private async fetchWithThrottle(query: string): Promise<Response> {
    await waitNominatimSlot(this.minIntervalMs);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchSearch(query, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  private fetchSearch(query: string, signal: AbortSignal): Promise<Response> {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    return fetch(url, {
      headers: { "User-Agent": this.userAgent },
      signal,
    });
  }

  private async mapResponse(
    response: Response,
    input: { rawText: string; regionCode?: string },
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
