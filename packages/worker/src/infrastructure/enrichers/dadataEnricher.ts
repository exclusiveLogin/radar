import type { ILocationEnricher, LocationCandidate } from "@radar/shared";
import { mapDadataSuggestion, type DadataSuggestion } from "./mapDadataSuggestion.js";

/**
 * Геокодинг через DaData suggest/address: FIAS + geo_lat/geo_lon.
 * Без `DADATA_TOKEN` — no-op (пайплайн не падает).
 */
export class DadataEnricher implements ILocationEnricher {
  readonly name = "dadata";

  constructor(
    private readonly token: string | undefined,
    private readonly timeoutMs = 5000,
  ) {}

  async enrich(input: { rawText: string; regionCode?: string }): Promise<LocationCandidate | null> {
    if (!this.token) return null;

    const queryNorm = input.rawText.toLowerCase().trim();
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
            query: input.rawText,
            count: 1,
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) return null;
      const payload = (await response.json()) as { suggestions?: DadataSuggestion[] };
      const best = payload.suggestions?.[0];
      if (!best) return null;
      return mapDadataSuggestion(best, {
        queryNorm,
        regionCodeHint: input.regionCode,
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
