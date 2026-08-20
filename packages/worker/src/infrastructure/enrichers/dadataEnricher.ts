import type { ILocationEnricher, LocationCandidate } from "@radar/shared";
import { isDadataSuggestionRegionConsistent } from "./dadataSuggestionRegionMatch.js";
import { waitExternalGeocoderSlot } from "./nominatimRateLimit.js";
import { mapDadataSuggestion, type DadataSuggestion } from "./mapDadataSuggestion.js";

/** 403: у токена нет доступа к suggest/address (тариф или другой продукт). */
function isSuggestionsAccessDenied(status: number, body: string): boolean {
  return status === 403 && /SUGGESTIONS/i.test(body);
}

type SuggestResult =
  | { ok: true; suggestions: DadataSuggestion[] }
  | { ok: false; fatal: boolean };

/**
 * Геокодинг через DaData suggest/address: FIAS + geo_lat/geo_lon.
 * Без `DADATA_TOKEN` — no-op (пайплайн не падает).
 */
export class DadataEnricher implements ILocationEnricher {
  readonly name = "dadata";

  /** После fatal 403 на SUGGESTIONS — не долбить API на каждый place. */
  private suggestionsAccessDenied = false;

  constructor(
    private readonly token: string | undefined,
    private readonly timeoutMs = 5000,
  ) {}

  /** Токен есть, но suggest/address недоступен (403 SUGGESTIONS disabled). */
  isSuggestionsBlocked(): boolean {
    return this.suggestionsAccessDenied;
  }

  async enrich(input: { rawText: string; regionCode?: string }): Promise<LocationCandidate | null> {
    if (!this.token) {
      console.warn("[dadata] DADATA_TOKEN не задан — HTTP не вызывается");
      return null;
    }

    if (this.suggestionsAccessDenied) {
      return null;
    }

    const queryNorm = input.rawText.toLowerCase().trim();
    if (!queryNorm) {
      console.warn("[dadata] пустой query — HTTP не вызывается");
      return null;
    }

    await waitExternalGeocoderSlot(0);

    const scoped = await this.fetchSuggestions(input.rawText, input.regionCode);
    if (!scoped.ok) {
      return null;
    }

    let best = scoped.suggestions[0];
    let usedFallback = false;

    if (!best && input.regionCode) {
      await waitExternalGeocoderSlot(0);
      const fallback = await this.fetchSuggestions(input.rawText);
      if (!fallback.ok) {
        return null;
      }
      best = fallback.suggestions[0];
      usedFallback = Boolean(best);
    }

    if (!best) {
      console.warn(`[dadata] пустой suggestions query=${JSON.stringify(input.rawText.slice(0, 80))}`);
      return null;
    }

    if (usedFallback && !isDadataSuggestionRegionConsistent({
      regionCodeHint: input.regionCode,
      queryNorm,
      suggestion: best,
    })) {
      console.warn(
        `[dadata] fallback отклонён (регион) query=${JSON.stringify(input.rawText.slice(0, 80))} hint=${input.regionCode}`,
      );
      return null;
    }

    if (usedFallback) {
      console.warn(
        `[dadata] fallback без locations query=${JSON.stringify(input.rawText.slice(0, 80))} hint=${input.regionCode}`,
      );
    }

    const mapped = mapDadataSuggestion(best, {
      queryNorm,
      regionCodeHint: input.regionCode,
    });
    if (!mapped) {
      console.warn(`[dadata] mapDadataSuggestion=null query=${JSON.stringify(input.rawText.slice(0, 80))}`);
    }
    return mapped;
  }

  /** suggest/address; regionCode → locations.region_iso_code. */
  private async fetchSuggestions(
    query: string,
    regionCode?: string,
  ): Promise<SuggestResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(
        "https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address",
        {
          method: "POST",
          headers: {
            Authorization: `Token ${this.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query,
            count: 1,
            ...(regionCode ? { locations: [{ region_iso_code: regionCode }] } : {}),
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        if (isSuggestionsAccessDenied(response.status, body)) {
          this.suggestionsAccessDenied = true;
          console.error(
            "[dadata] FATAL HTTP 403: Feature SUGGESTIONS disabled for DADATA_TOKEN. "
              + "Нужен ключ с доступом к «Подсказки» → suggest/address (dadata.ru/profile). "
              + "geo-dadata будет no-op до смены токена и перезапуска worker.",
          );
          return { ok: false, fatal: true };
        }
        console.warn(
          `[dadata] HTTP ${response.status} query=${JSON.stringify(query.slice(0, 80))} ${body.slice(0, 120)}`,
        );
        return { ok: false, fatal: false };
      }
      const payload = (await response.json()) as { suggestions?: DadataSuggestion[] };
      return { ok: true, suggestions: payload.suggestions ?? [] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[dadata] ${message} query=${JSON.stringify(query.slice(0, 80))}`);
      return { ok: false, fatal: false };
    } finally {
      clearTimeout(timer);
    }
  }
}
