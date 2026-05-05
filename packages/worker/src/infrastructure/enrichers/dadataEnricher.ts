import type { ILocationEnricher, LocationCandidate } from "@radar/shared";

/**
 * Use-case:
 * - Когда в сообщении есть уточняющий топоним (город/село/район),
 *   пытаемся получить FIAS + координаты.
 * - Если токен не задан или API недоступно, возвращаем null (без падения пайплайна).
 */
type DadataSuggestion = {
  value?: string;
  data?: Record<string, unknown>;
};

export class DadataEnricher implements ILocationEnricher {
  readonly name = "dadata";

  constructor(
    private readonly token: string | undefined,
    private readonly timeoutMs = 5000,
  ) {}

  async enrich(input: { rawText: string; regionCode?: string }): Promise<LocationCandidate | null> {
    if (!this.token) return null;

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
      if (!best?.data) return null;
      return {
        provider: this.name,
        queryNorm: input.rawText.toLowerCase(),
        regionCode: input.regionCode ?? String(best.data.region_kladr_id ?? ""),
        placeName: String(best.value ?? ""),
        placeFias: String(best.data.fias_id ?? ""),
        lat: best.data.geo_lat ? Number(best.data.geo_lat) : undefined,
        lon: best.data.geo_lon ? Number(best.data.geo_lon) : undefined,
        raw: best.data,
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
