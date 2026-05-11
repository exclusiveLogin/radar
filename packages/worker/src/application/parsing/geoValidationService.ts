import type {
  EventLocation,
  IPlaceAliasRepository,
  IPlaceEvidenceRepository,
  IPlaceRepository,
  PlaceContribution,
  PlaceProvider,
  IRegionRepository,
  PlaceRecord,
} from "@radar/shared";
import { randomUUID } from "node:crypto";

export type GeoValidationResult = {
  decision: "matched_existing" | "created_new" | "rejected";
  location: EventLocation | null;
};

export type GeoValidationContext = {
  providerHint?: PlaceProvider;
  confidence?: number;
  traceId?: string;
};

const TRUSTED_PROVIDERS = new Set<PlaceProvider>([
  "catalog",
  "dadata",
  "operator",
  "system",
]);

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ");
}

function sourceToProvider(source: EventLocation["source"]): PlaceProvider {
  switch (source) {
    case "db":
      return "catalog";
    case "cache":
      return "system";
    case "dadata":
      return "dadata";
    case "nominatim":
      return "nominatim";
    case "llm":
      return "llm";
  }
}

function toTrustState(
  provider: PlaceProvider,
  confidence: number | undefined,
): {
  trustState: PlaceRecord["trustState"];
  isTrusted: boolean;
  trustScore: number;
} {
  const scoreByProvider: Record<PlaceProvider, number> = {
    catalog: 1,
    dadata: 0.95,
    nominatim: 0.8,
    llm: 0.55,
    operator: 1,
    system: 0.7,
  };
  const trustScore = confidence ?? scoreByProvider[provider];
  const isTrusted = TRUSTED_PROVIDERS.has(provider) || trustScore >= 0.9;
  const trustState: PlaceRecord["trustState"] = isTrusted
    ? "verified"
    : trustScore >= 0.7
      ? "partially_verified"
      : "unverified";
  return { trustState, isTrusted, trustScore };
}

export class GeoValidationService {
  constructor(
    private readonly regions: IRegionRepository,
    private readonly places: IPlaceRepository,
    private readonly aliases: IPlaceAliasRepository,
    private readonly placeEvidence: IPlaceEvidenceRepository,
  ) {}

  async applyProviderContribution(
    input: PlaceContribution,
  ): Promise<{ updated: PlaceRecord; appliedFields: string[] }> {
    const merged = await this.places.mergeContribution(input);
    await this.placeEvidence.append({
      id: randomUUID(),
      placeId: input.placeId,
      provider: input.provider,
      action: merged.appliedFields.length > 0 ? "enrich" : "confirm",
      confidence: input.confidence,
      traceId: input.traceId,
      payload: {
        ...(input.rawPayload ?? {}),
        appliedFields: merged.appliedFields,
      },
      createdAt: new Date().toISOString(),
    });
    return merged;
  }

  async validate(
    rawQuery: string,
    location: EventLocation,
    context: GeoValidationContext = {},
  ): Promise<GeoValidationResult> {
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

    const provider = context.providerHint ?? sourceToProvider(location.source);
    const trust = toTrustState(provider, context.confidence);
    const matched = await this.matchPlace(location.placeName, region.id, location.placeFias);

    if (matched) {
      await this.aliases.upsertAlias({
        targetKind: "place",
        placeId: matched.id,
        alias: location.placeName,
        source: "auto",
      });
      const contribution: PlaceContribution = {
        placeId: matched.id,
        provider,
        confidence: context.confidence,
        traceId: context.traceId,
        trustState: trust.trustState ?? "unverified",
        isTrusted: trust.isTrusted,
        trustScore: trust.trustScore,
        fields: {
          name: location.placeName,
          fiasId: location.placeFias,
          centroidLat: location.lat,
          centroidLon: location.lon,
        },
        rawPayload: {
          reason: "matched_existing",
          rawQuery,
          locationSource: location.source,
        },
      };
      const merged = await this.applyProviderContribution(contribution);

      return {
        decision: "matched_existing",
        location: {
          ...location,
          regionId: region.id,
          placeId: matched.id,
          placeName: merged.updated.name,
          placeFias: merged.updated.fiasId,
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
        centroidLat: location.lat,
        centroidLon: location.lon,
        trustState: trust.trustState,
        isTrusted: trust.isTrusted,
        trustScore: trust.trustScore,
        trustUpdatedAt: new Date().toISOString(),
        evidenceProviders: [provider],
      },
    ]);
    await this.aliases.upsertAlias({
      targetKind: "place",
      placeId,
      alias: location.placeName,
      source: "auto",
    });
    await this.placeEvidence.append({
      id: randomUUID(),
      placeId,
      provider,
      action: "candidate",
      confidence: context.confidence,
      traceId: context.traceId,
      payload: {
        rawQuery,
        reason: "created_from_validation",
        locationSource: location.source,
      },
      createdAt: new Date().toISOString(),
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
