import type { EventLocation, ILocationEnricher } from "@radar/shared";
import type { GeoCatalog, GeoCatalogPlace } from "../../infrastructure/geo-catalog/index.js";

function toPrecision(kind: GeoCatalogPlace["kind"]): EventLocation["precision"] {
  if (kind === "district") return "district";
  if (kind === "city") return "city";
  if (kind === "settlement") return "settlement";
  return "locality";
}

export class LocationResolutionService {
  constructor(
    private readonly geoCatalog: GeoCatalog,
    private readonly enricher: ILocationEnricher,
  ) {}

  async resolve(rawText: string): Promise<{
    locations: EventLocation[];
    diagnostics: {
      invoked: boolean;
      cacheHit: boolean;
      provider?: "dadata" | "nominatim" | "llm";
      regionDetected: boolean;
      localPlacesFound: number;
    };
  }> {
    const regions = this.geoCatalog.findRegions(rawText);

    if (regions.length > 1) {
      return {
        locations: regions.map((region) => ({
          regionId: "00000000-0000-0000-0000-000000000000",
          regionCode: region.code,
          regionFias: region.fiasId,
          precision: "region",
          source: "db",
          placeName: region.name,
        })),
        diagnostics: {
          invoked: false,
          cacheHit: false,
          regionDetected: true,
          localPlacesFound: 0,
        },
      };
    }

    const region = regions[0];
    const localPlaces = region
      ? this.geoCatalog.findPlacesInRegion(rawText, region.code)
      : [];

    if (region && localPlaces.length > 0) {
      return {
        locations: [
          {
            regionId: "00000000-0000-0000-0000-000000000000",
            regionCode: region.code,
            regionFias: region.fiasId,
            precision: "region",
            source: "db" as const,
            placeName: region.name,
          },
          ...localPlaces.map((place) => ({
            regionId: "00000000-0000-0000-0000-000000000000",
            regionCode: region.code,
            regionFias: region.fiasId,
            precision: toPrecision(place.kind),
            source: "db" as const,
            placeName: place.name,
            lat: place.lat,
            lon: place.lon,
          })),
        ],
        diagnostics: {
          invoked: false,
          cacheHit: false,
          regionDetected: true,
          localPlacesFound: localPlaces.length,
        },
      };
    }

    if (region) {
      return {
        locations: [
          {
            regionId: "00000000-0000-0000-0000-000000000000",
            regionCode: region.code,
            regionFias: region.fiasId,
            precision: "region",
            source: "db",
            placeName: region.name,
          },
        ],
        diagnostics: {
          invoked: false,
          cacheHit: false,
          regionDetected: true,
          localPlacesFound: 0,
        },
      };
    }

    const cityOnlyPlaces = this.geoCatalog
      .findPlacesInRegion(rawText)
      .filter((place) => place.kind === "city");

    if (cityOnlyPlaces.length > 0) {
      return {
        locations: cityOnlyPlaces.map((place) => ({
          regionId: "00000000-0000-0000-0000-000000000000",
          regionCode: "unknown",
          precision: "city",
          source: "db" as const,
          placeName: place.name,
          lat: place.lat,
          lon: place.lon,
        })),
        diagnostics: {
          invoked: false,
          cacheHit: false,
          regionDetected: false,
          localPlacesFound: cityOnlyPlaces.length,
        },
      };
    }

    const enriched = await this.enricher.enrich({ rawText });
    const cacheHit = Boolean(enriched?.raw?.__cacheHit);

    if (!enriched) {
      return {
        locations: [],
        diagnostics: {
          invoked: true,
          cacheHit: false,
          regionDetected: false,
          localPlacesFound: 0,
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
        regionDetected: false,
        localPlacesFound: 0,
      },
    };
  }
}
