/**
 * Валидация геокандидатов при parse: match/create place, merge, evidence.
 * @see ../../../../../docs/domain/contexts/geo-place.md
 * @see ../../../../../docs/domain/how-it-works.md#place-trust-flow
 */
import {
  canonicalRegionCode,
  type EventLocation,
  type IPlaceAliasRepository,
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
} from "../../domain/geo/coordRegionReconcile.js";
import {
  filterRegionsByTextContext,
  findLocalityAnchorsInText,
  regionHasExplicitMentionInText,
  resolvePlaceRegionCodeInContext,
  type RegionCandidate,
} from "../../domain/geo/geographicTextContext.js";
import {
  isGarbageIngestPlaceName,
} from "../../domain/parsing/channelCityListPromo.js";
import { KnownLocalityCatalog } from "../../infrastructure/geo-catalog/knownLocalityCatalog.js";

export type GeoValidationResult = {
  decision: "matched_existing" | "created_new" | "rejected";
  location: EventLocation | null;
};

export type GeoValidationContext = {
  providerHint?: PlaceProvider;
  confidence?: number;
  traceId?: string;
  /** Обоснование привязки от LLM для диагностики. */
  reason?: string;
  /** Разрешает изменять существующий place из ingest-потока (по умолчанию выключено). */
  allowPlaceUpdates?: boolean;
  /** Несколько НП в одном сообщении — запрет «регион по умолчанию из хвоста текста». */
  multiPlaceContext?: boolean;
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
    return this.places.mergeContribution(input);
  }

  /** Матч субъекта через place(kind=region) + place_aliases. */
  private async resolveRegionByAlias(text: string | undefined): Promise<RegionRecord | null> {
    if (!text?.trim()) return null;
    const aliasMatches = await this.aliases.findByAlias(normalize(text));
    for (const row of aliasMatches) {
      const place = await this.places.findById(row.placeId);
      if (!place || place.kind !== "region") continue;
      const region = await this.regions.findById(place.regionId);
      if (region) return region;
    }
    return null;
  }

  /** Кандидаты субъектов, упомянутых в тексте (SSOT с finalizer). */
  private async collectRegionsInText(
    rawText: string,
    anchors: ReturnType<typeof findLocalityAnchorsInText>,
  ): Promise<RegionCandidate[]> {
    const allRegions = await this.regions.listActive();
    const candidates: RegionCandidate[] = allRegions.map((region) => ({
      code: canonicalRegionCode(region),
      name: region.name,
      fiasId: region.fiasId ?? undefined,
      aliases: [],
    }));
    return filterRegionsByTextContext(candidates, rawText, anchors);
  }

  /** Локация уровня субъекта: только явно распознанный region, без create place. */
  private async resolveRegionEntity(
    location: EventLocation,
    rawText: string,
  ): Promise<RegionRecord | null> {
    if (location.regionCode) {
      const fromAlias = await this.resolveRegionByAlias(location.regionCode);
      if (fromAlias) return fromAlias;
      const fromCode = await this.regions.findByCode(location.regionCode);
      if (fromCode) return fromCode;
    }

    if (location.placeName) {
      const fromNameAlias = await this.resolveRegionByAlias(location.placeName);
      if (fromNameAlias) return fromNameAlias;
    }

    const catalog = KnownLocalityCatalog.loadFromDictionaries().list();
    const anchors = findLocalityAnchorsInText(rawText, catalog);
    const regionsInText = await this.collectRegionsInText(rawText, anchors);
    const explicit = regionsInText.find((region) =>
      regionHasExplicitMentionInText(rawText, region),
    );
    if (!explicit) {
      return null;
    }
    return this.regions.findByCode(explicit.code);
  }

  /**
   * Регион для НП: тот же SSOT, что finalizer (places.json → якорь → явный субъект).
   * Без regionCode — reject, «хвост сообщения» не используется.
   */
  private async resolvePlaceEntityRegion(
    location: EventLocation,
    rawText: string,
    multiPlaceContext: boolean,
  ): Promise<RegionRecord | null> {
    const catalog = KnownLocalityCatalog.loadFromDictionaries().list();
    const anchors = findLocalityAnchorsInText(rawText, catalog);
    const regionsCollected = await this.collectRegionsInText(rawText, anchors);
    const regionCode = resolvePlaceRegionCodeInContext({
      placeName: location.placeName!,
      placeRegionCode: location.regionCode,
      rawText,
      anchorsInText: anchors,
      localityCatalog: catalog,
      regionsCollected,
      multiPlaceContext,
    });
    if (!regionCode) {
      return null;
    }
    return this.regions.findByCode(regionCode);
  }

  private isRegionLevelLocation(location: EventLocation): boolean {
    return location.entityKind === "region" || location.precision === "region";
  }

  async validate(
    rawQuery: string,
    location: EventLocation,
    context: GeoValidationContext = {},
  ): Promise<GeoValidationResult> {
    const multiPlaceContext = context.multiPlaceContext ?? false;

    if (this.isRegionLevelLocation(location)) {
      const region = await this.resolveRegionEntity(location, rawQuery);
      if (!region) {
        return { decision: "rejected", location: null };
      }
      return {
        decision: "matched_existing",
        location: {
          ...withResolvedRegion(location, region),
          entityKind: "region",
          placeId: undefined,
        },
      };
    }

    if (!location.placeName || isGarbageIngestPlaceName(location.placeName)) {
      return { decision: "rejected", location: null };
    }

    const region = await this.resolvePlaceEntityRegion(
      location,
      rawQuery,
      multiPlaceContext,
    );
    if (!region) {
      return { decision: "rejected", location: null };
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
      const placeRegion = await this.regions.findById(matched.regionId);
      if (!placeRegion) {
        return { decision: "rejected", location: null };
      }
      await this.aliases.upsertAlias({
        placeId: matched.id,
        alias: location.placeName,
        source: "auto",
      });
      if (context.allowPlaceUpdates) {
        await this.applyProviderContribution(
          this.buildMatchedContribution({
            placeId: matched.id,
            provider,
            context,
            trust,
            location,
            rawQuery,
          }),
        );
      }

      return {
        decision: "matched_existing",
        location: {
          ...withResolvedRegion(location, placeRegion),
          placeId: matched.id,
          placeName: matched.name,
          placeFias: matched.fiasId,
          entityKind: "place",
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
      placeId,
      alias: location.placeName,
      source: "auto",
    });
    return {
      decision: "created_new",
      location: {
        ...withResolvedRegion(location, region),
        placeId,
        entityKind: "place",
      },
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
      const place = await this.places.findById(row.placeId);
      if (!place || place.kind === "region") {
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
