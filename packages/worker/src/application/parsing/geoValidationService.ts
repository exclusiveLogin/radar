import type {
  EventLocation,
  IPlaceAliasRepository,
  IPlaceEvidenceRepository,
  IPlaceRepository,
  IRegionRepository,
  PlaceRecord,
} from "@radar/shared";
import { randomUUID } from "node:crypto";

export type GeoValidationResult = {
  decision: "matched_existing" | "created_new" | "rejected";
  location: EventLocation | null;
};

export type GeoValidationContext = {
  providerHint?: "catalog" | "dadata" | "nominatim" | "llm" | "operator" | "system";
  confidence?: number;
  traceId?: string;
};

type EvidenceProvider = "catalog" | "dadata" | "nominatim" | "llm" | "operator" | "system";

const TRUSTED_PROVIDERS = new Set<EvidenceProvider>([
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

function sourceToProvider(source: EventLocation["source"]): EvidenceProvider {
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

function mergeEvidenceProviders(
  current: PlaceRecord["evidenceProviders"],
  provider: EvidenceProvider,
): PlaceRecord["evidenceProviders"] {
  const merged = new Set<EvidenceProvider>([...(current ?? []), provider]);
  return [...merged];
}

function toTrustState(
  provider: EvidenceProvider,
  confidence: number | undefined,
): {
  trustState: PlaceRecord["trustState"];
  isTrusted: boolean;
  trustScore: number;
} {
  const scoreByProvider: Record<EvidenceProvider, number> = {
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
      await this.placeEvidence.append({
        id: randomUUID(),
        placeId: matched.id,
        provider,
        action: "confirm",
        confidence: context.confidence,
        traceId: context.traceId,
        payload: {
          rawQuery,
          matchedBy: "fias_alias_or_name",
          locationSource: location.source,
        },
        createdAt: new Date().toISOString(),
      });
      await this.places.upsertMany([
        {
          ...matched,
          evidenceProviders: mergeEvidenceProviders(matched.evidenceProviders, provider),
          trustState: trust.trustState ?? matched.trustState,
          isTrusted: trust.isTrusted || matched.isTrusted === true,
          trustScore: Math.max(matched.trustScore ?? 0, trust.trustScore),
          trustUpdatedAt: new Date().toISOString(),
        },
      ]);

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
