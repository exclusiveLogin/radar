import type { ILocationEnricher, LocationCandidate } from "@radar/shared";

type NominatimItem = {
  display_name?: string;
  lat?: string;
  lon?: string;
};

export class NominatimEnricher implements ILocationEnricher {
  readonly name = "nominatim";

  constructor(private readonly timeoutMs = 5000) {}async enrich(input: { rawText: string; regionCode?: string }): Promise<LocationCandidate | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("q", input.rawText);
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("limit", "1");
      const response = await fetch(url, {
        headers: { "User-Agent": "radar-worker/0.1" },
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as NominatimItem[];
      const best = payload[0];
      if (!best) return null;
      return {
        provider: this.name,
        queryNorm: input.rawText.toLowerCase(),
        regionCode: input.regionCode,
        placeName: best.display_name,
        lat: best.lat ? Number(best.lat) : undefined,
        lon: best.lon ? Number(best.lon) : undefined,
        raw: best as Record<string, unknown>,
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
