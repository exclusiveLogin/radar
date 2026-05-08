import type {
  EventLocation,
  IPlaceAliasRepository,
  IPlaceRepository,
  IRegionRepository,
  PlaceRecord,
} from "@radar/shared";
import { randomUUID } from "node:crypto";

export type GeoValidationResult = {
  decision: "matched_existing" | "created_new" | "rejected";
  location: EventLocation | null;
};

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ");
}

export class GeoValidationService {
  constructor(
    private readonly regions: IRegionRepository,
    private readonly places: IPlaceRepository,
    private readonly aliases: IPlaceAliasRepository,
  ) {}

  async validate(rawQuery: string, location: EventLocation): Promise<GeoValidationResult> {
    const region = await this.regions.findByCode(location.regionCode);
    if (!region) {
      return { decision: "rejected", location: null };
    }

    if (!location.placeName) {
      return {
        decision: "rejected",
        location: { ...location, regionId: region.id },
      };
    }

    const matched = await this.matchPlace(location.placeName, region.id, location.placeFias);
    if (matched) {
      // Upsert alias by placeName so future events with the same place name hit the cache.
      await this.aliases.upsertAlias({
        targetKind: "place",
        placeId: matched.id,
        alias: location.placeName,
        source: "auto",
      });
      return {
        decision: "matched_existing",
        location: {
          ...location,
          regionId: region.id,
          placeId: matched.id,
          placeName: matched.name,
          placeFias: matched.fiasId,
        },
      };
    }

    const placeId = randomUUID();
    await this.places.upsertMany([
      {
        id: placeId,
        regionId: region.id,
        kind: "locality",
        name: location.placeName,
        fiasId: location.placeFias,
      },
    ]);
    await this.aliases.upsertAlias({
      targetKind: "place",
      placeId,
      alias: location.placeName,
      source: "auto",
    });

    return {
      decision: "created_new",
      location: { ...location, regionId: region.id, placeId },
    };
  }

  private async matchPlace(
    placeName: string,
    regionId: string,
    placeFias?: string,
  ): Promise<PlaceRecord | null> {
    if (placeFias) {
      const byFias = await this.places.findByFias(placeFias);
      if (byFias) return byFias;
    }

    const aliasMatches = await this.aliases.findByAlias(normalize(placeName));
    const placeAlias = aliasMatches.find((row) => row.placeId);
    if (placeAlias?.placeId) {
      const place = await this.places.findById(placeAlias.placeId);
      if (place) return place;
    }

    return this.places.findByNameInRegion(placeName, regionId);
  }
}
