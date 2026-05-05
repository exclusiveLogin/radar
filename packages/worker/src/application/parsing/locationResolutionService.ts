import type { EventLocation, ILocationEnricher } from "@radar/shared";

const REGION_PATTERNS: Array<{ regex: RegExp; code: string; name: string }> = [
  { regex: /\bбелгородск/i, code: "31", name: "Белгородская область" },
  { regex: /\bбрянск/i, code: "32", name: "Брянская область" },
  { regex: /\bкурск/i, code: "46", name: "Курская область" },
  { regex: /\bростов/i, code: "61", name: "Ростовская область" },
  { regex: /\bворонеж/i, code: "36", name: "Воронежская область" },
];

function detectRegion(text: string): { code: string; name: string } | null {
  for (const row of REGION_PATTERNS) {
    if (row.regex.test(text)) return { code: row.code, name: row.name };
  }
  return null;
}

export class LocationResolutionService {
  constructor(private readonly enricher: ILocationEnricher) {}

  async resolve(rawText: string): Promise<EventLocation[]> {
    const region = detectRegion(rawText);
    if (region) {
      return [
        {
          regionId: "00000000-0000-0000-0000-000000000000",
          regionCode: region.code,
          precision: "region",
          source: "db",
          placeName: region.name,
        },
      ];
    }

    const enriched = await this.enricher.enrich({ rawText });
    if (!enriched) return [];
    return [
      {
        regionId: "00000000-0000-0000-0000-000000000000",
        regionCode: enriched.regionCode ?? "unknown",
        precision: "locality",
        source:
          enriched.provider === "dadata"
            ? "dadata"
            : enriched.provider === "nominatim"
              ? "nominatim"
              : "llm",
        placeName: enriched.placeName,
        placeFias: enriched.placeFias,
        lat: enriched.lat,
        lon: enriched.lon,
      },
    ];
  }
}
