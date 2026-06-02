/**
 * Валидация геокандидатов при parse: match/create place, merge, evidence.
 * @see ../../../../../docs/domain/contexts/geo-place.md
 * @see ../../../../../docs/domain/how-it-works.md#place-trust-flow
 */
import {
  canonicalRegionCode,
  type EventLocation,
  type IPlaceAliasRepository,
  type IPlaceEvidenceRepository,
  type IPlaceRepository,
  type PlaceContribution,
  type PlaceProvider,
  type IRegionRepository,
  type PlaceRecord,
  type RegionRecord,
} from "@radar/shared";
import { randomUUID } from "node:crypto";
import {
  isCoordConsistentWithRegion,
  isTrustedGeocodeSource,
  resolveRegionCodeForCoords,
} from "../../domain/geo/coordRegionReconcile.js";
import {
  lookupLocalityRegionForPlace,
} from "../../domain/geo/geographicTextContext.js";
import { KnownLocalityCatalog } from "../../infrastructure/geo-catalog/knownLocalityCatalog.js";

export type GeoValidationResult = {
  decision: "matched_existing" | "created_new" | "rejected";
  location: EventLocation | null;
};

export type GeoValidationContext = {
  providerHint?: PlaceProvider;
  confidence?: number;
  traceId?: string;
  /** Обоснование привязки от LLM (персистится в place_evidence для анализа). */
  reason?: string;
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

/** Подставляет regionId и канонический ISO в локацию после резолва региона. */
function withResolvedRegion(
  location: EventLocation,
  region: RegionRecord,
): EventLocation {
  return {
    ...location,
    regionId: region.id,
    regionCode: canonicalRegionCode(region),
  };
}

export class GeoValidationService {
  constructor(
    private readonly regions: IRegionRepository,
    private readonly places: IPlaceRepository,
    private readonly aliases: IPlaceAliasRepository,
    private readonly placeEvidence: IPlaceEvidenceRepository,
  ) {}

  private buildMatchedContribution(input: {
    placeId: string;
    provider: PlaceProvider;
    context: GeoValidationContext;
    trust: ReturnType<typeof toTrustState>;
    location: EventLocation;
    rawQuery: string;
  }): PlaceContribution {
    const { placeId, provider, context, trust, location, rawQuery } = input;
    return {
      placeId,
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
        ...(context.reason ? { llmReason: context.reason } : {}),
      },
    };
  }

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

  /** Субъект РФ с учётом справочника НП и согласования coords vs текст. */
  private async resolveEffectiveRegion(
    location: EventLocation,
  ): Promise<RegionRecord | null> {
    const catalog = KnownLocalityCatalog.loadFromDictionaries().list();
    if (location.placeName) {
      const fromCatalog = lookupLocalityRegionForPlace(
        location.placeName,
        catalog,
      );
      if (fromCatalog) {
        const region = await this.regions.findByCode(fromCatalog);
        if (region) {
          return region;
        }
      }
    }

    const textRegion = await this.regions.findByCode(location.regionCode);
    const allRegions = await this.regions.listActive();
    const reconciledCode = resolveRegionCodeForCoords(
      location,
      textRegion,
      allRegions,
    );
    if (reconciledCode) {
      const reconciled = await this.regions.findByCode(reconciledCode);
      if (reconciled) {
        return reconciled;
      }
    }

    return textRegion;
  }

  async validate(
    rawQuery: string,
    location: EventLocation,
    context: GeoValidationContext = {},
  ): Promise<GeoValidationResult> {
    const region = await this.resolveEffectiveRegion(location);
    if (!region) {
      return { decision: "rejected", location: null };
    }

    if (!location.placeName) {
      return {
        decision: "rejected",
        location: withResolvedRegion(location, region),
      };
    }

    const provider = context.providerHint ?? sourceToProvider(location.source);
    const trust = toTrustState(provider, context.confidence);
    const matched = await this.matchPlace(
      location.placeName,
      region,
      location,
      location.placeFias,
    );

    if (matched) {
      await this.aliases.upsertAlias({
        targetKind: "place",
        placeId: matched.id,
        alias: location.placeName,
        source: "auto",
      });
      const merged = await this.applyProviderContribution(
        this.buildMatchedContribution({
          placeId: matched.id,
          provider,
          context,
          trust,
          location,
          rawQuery,
        }),
      );

      return {
        decision: "matched_existing",
        location: {
          ...withResolvedRegion(location, region),
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
        ...(context.reason ? { llmReason: context.reason } : {}),
      },
      createdAt: new Date().toISOString(),
    });

    return {
      decision: "created_new",
      location: { ...withResolvedRegion(location, region), placeId },
    };
  }

  private async matchPlace(
    placeName: string,
    region: RegionRecord,
    location: EventLocation,
    placeFias?: string,
  ): Promise<PlaceRecord | null> {
    const regionId = region.id;
    const regionsById = new Map(
      (await this.regions.listActive()).map((row) => [row.id, row]),
    );

    if (placeFias) {
      const byFias = await this.places.findByFias(placeFias);
      if (byFias?.regionId === regionId) {
        return byFias;
      }
    }

    const aliasMatches = await this.aliases.findByAlias(normalize(placeName));
    for (const row of aliasMatches) {
      if (!row.placeId) {
        continue;
      }
      const place = await this.places.findById(row.placeId);
      if (!place) {
        continue;
      }
      if (place.regionId === regionId) {
        return place;
      }
      if (
        location.lat != null
        && location.lon != null
        && isTrustedGeocodeSource(location.source)
      ) {
        const placeRegion = regionsById.get(place.regionId);
        if (
          placeRegion
          && !isCoordConsistentWithRegion(location.lat, location.lon, placeRegion)
        ) {
          continue;
        }
      }
      /**
       * Не матчим alias из чужого региона по одному имени:
       * это и давало "Красноармейский район" -> Приморский край
       * при явном контексте "Краснодарский край".
       */
      continue;
    }

    return this.places.findByNameInRegion(placeName, regionId);
  }
}
