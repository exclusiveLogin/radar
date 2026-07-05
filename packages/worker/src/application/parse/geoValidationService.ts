/**
 * Валидация геокандидатов при parse: match/create place, merge, evidence.
 * @see ../../../../../docs/domain/contexts/geo-place.md
 * @see ../../../../../docs/domain/how-it-works.md#place-trust-flow
 */
import {
  canonicalRegionCode,
  collectPlaceMatchStems,
  normalizePlaceMatchLabel,
  normalizeRegionCodeAlias,
  placeStem,
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
  shouldSuppressFederalSubjectMatch,
  type LocalityAnchor,
  type RegionCandidate,
} from "../../domain/geo/geographicTextContext.js";
import {
  isGarbageIngestPlaceName,
} from "../../domain/parsing/channelCityListPromo.js";

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
  /** Catalog heal: не создавать новый place — только match или reject. */
  catalogHeal?: boolean;
  /** Якорные НП из workspace — safety net для ложных region-level матчей. */
  localityAnchors?: LocalityAnchor[];
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

  /** ID place в БД после upsert (upsertMany может слить в существующую строку). */
  private async resolvePersistedPlaceId(
    region: RegionRecord,
    location: EventLocation,
    preferredId: string,
  ): Promise<string | null> {
    if (await this.places.findById(preferredId)) {
      return preferredId;
    }

    const rawName = location.placeName?.trim();
    if (rawName) {
      const byRawName = await this.places.findByNameInRegion(rawName, region.id);
      if (byRawName) {
        return byRawName.id;
      }
    }

    const matchLabel = rawName ? normalizePlaceMatchLabel(rawName) : "";
    if (matchLabel && matchLabel !== rawName) {
      const byLabel = await this.places.findByNameInRegion(matchLabel, region.id);
      if (byLabel) {
        return byLabel.id;
      }
    }

    if (rawName) {
      for (const stem of collectPlaceMatchStems(rawName)) {
        const byStem = await this.places.findByStemInRegion(stem, region.id);
        if (byStem) {
          return byStem.id;
        }
      }
    }

    return null;
  }

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

  /** Кандидаты субъектов через place(kind=region) stem в БД. */
  private async resolveRegionByStem(name: string): Promise<RegionRecord | null> {
    for (const stem of collectPlaceMatchStems(name)) {
      const matches = await this.places.findByStemGlobal(stem, {
        minKind: "region",
        maxKind: "region",
      });
      for (const place of matches) {
        const region = await this.regions.findById(place.regionId);
        if (region) return region;
      }
    }
    return null;
  }

  /** Локация уровня субъекта: stem-only через place(kind=region), без artifact catalog. */
  private async resolveRegionEntity(
    location: EventLocation,
  ): Promise<RegionRecord | null> {
    if (location.regionCode) {
      const normalizedCode = normalizeRegionCodeAlias(location.regionCode);
      const fromAlias = await this.resolveRegionByAlias(normalizedCode);
      if (fromAlias) return fromAlias;
      const fromCode = await this.regions.findByCode(normalizedCode);
      if (fromCode) return fromCode;
    }

    if (location.placeName) {
      const fromNameAlias = await this.resolveRegionByAlias(location.placeName);
      if (fromNameAlias) return fromNameAlias;
      const fromStem = await this.resolveRegionByStem(location.placeName);
      if (fromStem) return fromStem;
    }

    if (location.placeId) {
      const place = await this.places.findById(location.placeId);
      if (place?.kind === "region") {
        const region = await this.regions.findById(place.regionId);
        if (region) return region;
      }
    }

    return null;
  }

  /**
   * Регион для НП: placeId / regionCode на локации (P6 stem-only, без places.json).
   */
  private async resolvePlaceEntityRegion(
    location: EventLocation,
  ): Promise<RegionRecord | null> {
    if (location.placeId) {
      const place = await this.places.findById(location.placeId);
      if (place) {
        const region = await this.regions.findById(place.regionId);
        if (region) return region;
      }
    }

    if (location.regionCode) {
      const normalizedCode = normalizeRegionCodeAlias(location.regionCode);
      const bound =
        (await this.regions.findByCode(normalizedCode))
        ?? (await this.resolveRegionByAlias(normalizedCode))
        ?? (await this.resolveRegionByAlias(location.regionCode));
      if (bound) {
        return bound;
      }
    }

    return null;
  }

  private isRegionLevelLocation(location: EventLocation): boolean {
    return location.entityKind === "region" || location.precision === "region";
  }

  private toRegionCandidate(region: RegionRecord): RegionCandidate {
    const aliases = [region.shortName, region.name, region.nameWithType].filter(
      (value): value is string => Boolean(value?.trim()),
    );
    return {
      code: canonicalRegionCode(region),
      name: region.nameWithType ?? region.name,
      fiasId: region.fiasId,
      aliases,
    };
  }

  private isSuppressedFederalSubjectMatch(
    rawQuery: string,
    region: RegionRecord,
    context: GeoValidationContext,
  ): boolean {
    return shouldSuppressFederalSubjectMatch(
      rawQuery,
      this.toRegionCandidate(region),
      context.localityAnchors ?? [],
    );
  }

  async validate(
    rawQuery: string,
    location: EventLocation,
    context: GeoValidationContext = {},
  ): Promise<GeoValidationResult> {
    if (this.isRegionLevelLocation(location)) {
      const region = await this.resolveRegionEntity(location);
      if (!region) {
        return { decision: "rejected", location: null };
      }
      if (this.isSuppressedFederalSubjectMatch(rawQuery, region, context)) {
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

    const region = await this.resolvePlaceEntityRegion(location);
    if (!region) {
      return { decision: "rejected", location: null };
    }

    const provider = context.providerHint ?? sourceToProvider(location.source);
    const trust = toTrustState(provider, context.confidence);

    if (location.placeId) {
      const byId = await this.places.findById(location.placeId);
      if (byId && byId.kind !== "region" && byId.trustState !== "rejected") {
        const placeRegion = await this.regions.findById(byId.regionId);
        if (placeRegion) {
          return {
            decision: "matched_existing",
            location: {
              ...withResolvedRegion(location, placeRegion),
              placeId: byId.id,
              placeName: byId.name,
              placeFias: byId.fiasId,
              entityKind: "place",
            },
          };
        }
      }
    }

    const matched = await this.matchPlace(
      location.placeName,
      region,
      location,
      location.placeFias,
      undefined,
    );

    if (matched) {
      const placeRegion = await this.regions.findById(matched.regionId);
      if (!placeRegion) {
        return { decision: "rejected", location: null };
      }

      const persistedId = await this.resolvePersistedPlaceId(
        placeRegion,
        location,
        matched.id,
      );
      if (!persistedId) {
        return { decision: "rejected", location: null };
      }

      if (context.allowPlaceUpdates) {
        await this.applyProviderContribution(
          this.buildMatchedContribution({
            placeId: persistedId,
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
          placeId: persistedId,
          placeName: matched.name,
          placeFias: matched.fiasId,
          entityKind: "place",
        },
      };
    }

    if (context.catalogHeal) {
      return { decision: "rejected", location: null };
    }

    const placeId = randomUUID();
    await this.places.upsertMany([
      {
        id: placeId,
        regionId: region.id,
        kind: "locality",
        name: location.placeName,
        nameStem: placeStem(location.placeName),
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

    const persistedId = await this.resolvePersistedPlaceId(region, location, placeId);
    if (!persistedId) {
      return { decision: "rejected", location: null };
    }

    return {
      decision: "created_new",
      location: {
        ...withResolvedRegion(location, region),
        placeId: persistedId,
        entityKind: "place",
      },
    };
  }

  /**
   * Матч НП:
   *  1. FIAS (если есть) → прямой хит
   *  2. alias lookup → только тот же region_id
   *  3. name_stem lookup с опциональным preferKind (city_district при городском якоре)
   *  4. nameNormalized fallback (для legacy places без stem)
   */
  private async matchPlace(
    placeName: string,
    region: RegionRecord,
    location: EventLocation,
    placeFias?: string,
    preferKind?: PlaceRecord["kind"],
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

    const matchLabel = normalizePlaceMatchLabel(placeName);

    const aliasMatches = await this.aliases.findByAlias(normalize(matchLabel));
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
      // Не матчим alias из чужого региона — давало "Красноармейский район" → Приморский край
      continue;
    }

    for (const stem of collectPlaceMatchStems(placeName)) {
      const byStem = await this.places.findByStemInRegion(stem, regionId, preferKind);
      if (byStem) return byStem;
    }

    return this.places.findByNameInRegion(matchLabel, regionId);
  }
}
