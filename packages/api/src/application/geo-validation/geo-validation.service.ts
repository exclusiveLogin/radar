import type {
  EventLocation,
  IPlaceAliasRepository,
  IPlaceCacheRepository,
  IPlaceRepository,
  IRegionRepository,
  LocationCandidate,
  PlaceRecord,
} from "@radar/shared";
import { randomUUID } from "node:crypto";

export type GeoValidationInput = {
  rawQuery: string;
  candidate: LocationCandidate;
  fallbackRegionCode?: string;
};

export type GeoValidationResult = {
  eventLocation: EventLocation | null;
  decision: "matched_existing" | "created_new" | "rejected";
  placeId?: string;
};

function normalizeAlias(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export class GeoValidationService {
  constructor(
    private readonly regions: IRegionRepository,
    private readonly places: IPlaceRepository,
    private readonly aliases: IPlaceAliasRepository,
    private readonly cache: IPlaceCacheRepository,
  ) {}

  async validateAndResolve(
    input: GeoValidationInput,
  ): Promise<GeoValidationResult> {
    const queryNorm = normalizeAlias(input.rawQuery);
    const regionCode = input.candidate.regionCode ?? input.fallbackRegionCode;
    const region = regionCode ? await this.regions.findByCode(regionCode) : null;

    if (!region) {
      await this.cache.put(queryNorm, input.candidate.provider, input.candidate.raw, {
        validator: "provider",
      });
      return { eventLocation: null, decision: "rejected" };
    }

    const matched = await this.matchExistingPlace(input.candidate, region.id);
    if (matched) {
      await this.aliases.upsertAlias({
        targetKind: "place",
        placeId: matched.id,
        alias: input.rawQuery,
        source: "auto",
      });
      await this.cache.put(queryNorm, input.candidate.provider, input.candidate.raw, {
        validator: "provider",
      });
      return {
        decision: "matched_existing",
        placeId: matched.id,
        eventLocation: {
          regionId: region.id,
          regionCode: region.code,
          placeId: matched.id,
          placeName: matched.name,
          placeFias: matched.fiasId,
          precision: "locality",
          source: input.candidate.provider,
          lat: input.candidate.lat,
          lon: input.candidate.lon,
        },
      };
    }

    if (!input.candidate.placeName) {
      return { eventLocation: null, decision: "rejected" };
    }

    const newPlaceId = randomUUID();
    await this.places.upsertMany([
      {
        id: newPlaceId,
        regionId: region.id,
        kind: "locality",
        name: input.candidate.placeName,
        fiasId: input.candidate.placeFias,
      },
    ]);
    await this.aliases.upsertAlias({
      targetKind: "place",
      placeId: newPlaceId,
      alias: input.rawQuery,
      source: "auto",
    });
    await this.cache.put(queryNorm, input.candidate.provider, input.candidate.raw, {
      validator: "provider",
      validatedAt: new Date().toISOString(),
    });

    return {
      decision: "created_new",
      placeId: newPlaceId,
      eventLocation: {
        regionId: region.id,
        regionCode: region.code,
        placeId: newPlaceId,
        placeName: input.candidate.placeName,
        placeFias: input.candidate.placeFias,
        precision: "locality",
        source: input.candidate.provider,
        lat: input.candidate.lat,
        lon: input.candidate.lon,
      },
    };
  }

  private async matchExistingPlace(
    candidate: LocationCandidate,
    regionId: string,
  ): Promise<PlaceRecord | null> {
    if (candidate.placeFias) {
      const byFias = await this.places.findByFias(candidate.placeFias);
      if (byFias) {
        return byFias;
      }
    }

    if (candidate.queryNorm) {
      const byAlias = await this.aliases.findByAlias(
        normalizeAlias(candidate.queryNorm),
      );
      const placeAlias = byAlias.find((row) => row.placeId);
      if (placeAlias?.placeId) {
        const byId = await this.places.findById(placeAlias.placeId);
        if (byId) {
          return byId;
        }
      }
    }

    if (candidate.placeName) {
      const byName = await this.places.findByNameInRegion(
        candidate.placeName,
        regionId,
      );
      if (byName) {
        return byName;
      }
    }

    return null;
  }
}
