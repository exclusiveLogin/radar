import type {
  EventLocation,
  IPlaceAliasRepository,
  IPlaceCacheRepository,
  IPlaceRepository,
  IRegionRepository,
  LocationCandidate,
  PlaceRecord,
  RegionRecord,
} from "@radar/shared";
import { randomUUID } from "node:crypto";
import { normalizeGeoText } from "../geo/normalizeText";

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

export class GeoValidationService {
  constructor(
    private readonly regions: IRegionRepository,
    private readonly places: IPlaceRepository,
    private readonly aliases: IPlaceAliasRepository,
    private readonly cache: IPlaceCacheRepository,
  ) {}

  /** Persists provider validation result in place cache. */
  private async writeProviderCache(
    queryNorm: string,
    input: GeoValidationInput,
    withValidatedAt = false,
  ): Promise<void> {
    await this.cache.put(queryNorm, input.candidate.provider, input.candidate.raw, {
      validator: "provider",
      validatedAt: withValidatedAt ? new Date().toISOString() : undefined,
    });
  }

  /** Converts validated region/place pair into EventLocation DTO. */
  private toEventLocation(options: {
    region: Pick<RegionRecord, "id" | "code">;
    placeId: string;
    placeName: string;
    placeFias?: string;
    candidate: LocationCandidate;
  }): EventLocation {
    return {
      regionId: options.region.id,
      regionCode: options.region.code,
      placeId: options.placeId,
      placeName: options.placeName,
      placeFias: options.placeFias,
      precision: "locality",
      source: options.candidate.provider,
      lat: options.candidate.lat,
      lon: options.candidate.lon,
    };
  }

  /** Resolves region by candidate region code or fallback region code. */
  private async resolveRegionForValidation(
    input: GeoValidationInput,
  ): Promise<RegionRecord | null> {
    const regionCode = input.candidate.regionCode ?? input.fallbackRegionCode;
    return regionCode ? this.regions.findByCode(regionCode) : null;
  }

  /** Creates new locality record from provider candidate. */
  private async createPlaceFromCandidate(options: {
    regionId: string;
    candidate: LocationCandidate;
  }): Promise<string> {
    const placeId = randomUUID();
    await this.places.upsertMany([
      {
        id: placeId,
        regionId: options.regionId,
        kind: "locality",
        name: options.candidate.placeName!,
        fiasId: options.candidate.placeFias,
      },
    ]);
    return placeId;
  }

  /** Upserts auto-generated alias for resolved place. */
  private async upsertAutoAlias(placeId: string, alias: string): Promise<void> {
    await this.aliases.upsertAlias({
      targetKind: "place",
      placeId,
      alias,
      source: "auto",
    });
  }

  /** Main validation сценарий: match existing place or create new one. */
  async validateAndResolve(
    input: GeoValidationInput,
  ): Promise<GeoValidationResult> {
    const queryNorm = normalizeGeoText(input.rawQuery);
    const region = await this.resolveRegionForValidation(input);

    if (!region) {
      await this.writeProviderCache(queryNorm, input);
      return { eventLocation: null, decision: "rejected" };
    }

    const matched = await this.matchExistingPlace(input.candidate, region.id);
    if (matched) {
      await this.upsertAutoAlias(matched.id, input.rawQuery);
      await this.writeProviderCache(queryNorm, input);
      return {
        decision: "matched_existing",
        placeId: matched.id,
        eventLocation: this.toEventLocation({
          region,
          placeId: matched.id,
          placeName: matched.name,
          placeFias: matched.fiasId,
          candidate: input.candidate,
        }),
      };
    }

    if (!input.candidate.placeName) {
      return { eventLocation: null, decision: "rejected" };
    }

    const newPlaceId = await this.createPlaceFromCandidate({
      regionId: region.id,
      candidate: input.candidate,
    });
    await this.upsertAutoAlias(newPlaceId, input.rawQuery);
    await this.writeProviderCache(queryNorm, input, true);

    return {
      decision: "created_new",
      placeId: newPlaceId,
      eventLocation: this.toEventLocation({
        region,
        placeId: newPlaceId,
        placeName: input.candidate.placeName,
        placeFias: input.candidate.placeFias,
        candidate: input.candidate,
      }),
    };
  }

  /** Tries to match place by FIAS, alias index, then by name in region. */
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
        normalizeGeoText(candidate.queryNorm),
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
