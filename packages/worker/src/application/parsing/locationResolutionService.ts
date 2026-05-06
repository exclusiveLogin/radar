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

  async resolve(rawText: string): Promise<{
    locations: EventLocation[];
    diagnostics: {
      invoked: boolean;
      cacheHit: boolean;
      provider?: "dadata" | "nominatim" | "llm";
    };
  }> {
    const region = detectRegion(rawText);
    const enriched = await this.enricher.enrich({
      rawText,
      regionCode: region?.code,
    });
    const cacheHit = Boolean(enriched?.raw?.__cacheHit);

    if (region && enriched?.placeName) {
      return {
        locations: [
          {
            regionId: "00000000-0000-0000-0000-000000000000",
            regionCode: region.code,
            precision: "locality",
            source: enriched.provider,
            placeName: enriched.placeName,
            placeFias: enriched.placeFias,
            lat: enriched.lat,
            lon: enriched.lon,
          },
        ],
        diagnostics: {
          invoked: true,
          cacheHit,
          provider: enriched.provider,
        },
      };
    }

    if (region) {
      return {
        locations: [
          {
            regionId: "00000000-0000-0000-0000-000000000000",
            regionCode: region.code,
            precision: "region",
            source: "db",
            placeName: region.name,
          },
        ],
        diagnostics: {
          invoked: Boolean(enriched),
          cacheHit,
          provider: enriched?.provider,
        },
      };
    }

    if (!enriched) {
      return {
        locations: [],
        diagnostics: {
          invoked: true,
          cacheHit: false,
        },
      };
    }

    return {
      locations: [
        {
          regionId: "00000000-0000-0000-0000-000000000000",
          regionCode: enriched.regionCode ?? "unknown",
          precision: "locality",
          source: enriched.provider,
          placeName: enriched.placeName,
          placeFias: enriched.placeFias,
          lat: enriched.lat,
          lon: enriched.lon,
        },
      ],
      diagnostics: {
        invoked: true,
        cacheHit,
        provider: enriched.provider,
      },
    };
  }
}
