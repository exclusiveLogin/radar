/**
 * ---
 * layer: shared/ports
 * bounded-context: geo
 * purpose: Контракты хранения каталога географии и его обогащения.
 * ---
 */
import type { FindByStemGlobalOptions, PlaceScanEntry } from "./place-scan.js";

export type RegionRecord = {
  id: string;
  code: string;
  fiasId?: string;
  kladrId?: string;
  iso?: string;
  name: string;
  nameWithType?: string;
  shortName?: string;
  federalDistrict?: string;
  geometryArtifactKey?: string;
  centroidLat?: number;
  centroidLon?: number;
  bbox?: Record<string, unknown>;
  sourceMeta?: Record<string, unknown>;
  lastSourceRevision?: string;
  frontRegion: boolean;
  borderRegion: boolean;
  /** Precomputed дистанция (км) до ближайшего фронт-региона (regions.front_distance_km). */
  frontDistanceKm?: number | null;
};

export type PlaceRecord = {
  id: string;
  regionId: string;
  parentPlaceId?: string;
  kind:
    | "region"
    | "district"
    | "city_district"
    | "city"
    | "locality"
    | "settlement"
    | "urban_okrug"
    | "mo_go";
  name: string;
  nameWithType?: string;
  /** Стем имени для матча без alias-роста; вычисляется через placeStem(). */
  nameStem?: string;
  /** FK на geo_feature; заполняется при import или parse-match. */
  geoFeatureId?: string;
  fiasId?: string;
  kladrId?: string;
  oktmo?: string;
  geometryArtifactKey?: string;
  centroidLat?: number;
  centroidLon?: number;
  bbox?: Record<string, unknown>;
  sourceMeta?: Record<string, unknown>;
  lastSourceRevision?: string;
  trustState?: "unverified" | "partially_verified" | "verified" | "rejected";
  isTrusted?: boolean;
  trustScore?: number;
  trustUpdatedAt?: string;
  evidenceProviders?: PlaceProvider[];
};

export type PlaceProvider = "catalog" | "dadata" | "nominatim" | "llm" | "operator" | "system";
export type PlaceCacheProvider = "dadata" | "nominatim" | "llm";

export type PlaceAliasRecord = {
  id: string;
  placeId: string;
  alias: string;
  aliasNormalized: string;
  source?: "auto" | "manual";
};

export type StatusDictionaryRecord = {
  code: string;
  title: string;
  includeOnMap: boolean;
  parserHints?: string[];
  stateLevel: "grey" | "green" | "yellow" | "orange" | "red";
  isActive: boolean;
  priority?: number;
};

export type PlaceContribution = {
  placeId: string;
  provider: PlaceProvider;
  confidence?: number;
  traceId?: string;
  trustState: NonNullable<PlaceRecord["trustState"]>;
  isTrusted: boolean;
  trustScore: number;
  fields: Partial<
    Pick<
      PlaceRecord,
      | "name"
      | "nameWithType"
      | "kind"
      | "parentPlaceId"
      | "fiasId"
      | "kladrId"
      | "oktmo"
      | "geometryArtifactKey"
      | "centroidLat"
      | "centroidLon"
      | "bbox"
    >
  >;
  rawPayload?: Record<string, unknown>;
};

export type PlaceCacheHit = {
  provider: PlaceCacheProvider;
  raw: Record<string, unknown>;
  fetchedAt?: string;
  validatedAt?: string;
  confidence?: number;
};

export type PlaceCachePutMeta = {
  confidence?: number;
  validator?: "rule" | "human" | "provider";
  expiresAt?: string;
  validatedAt?: string;
};

export interface IRegionRepository {
  findById(id: string): Promise<RegionRecord | null>;
  findByCode(code: string): Promise<RegionRecord | null>;
  listActive(): Promise<RegionRecord[]>;
  upsertMany(regions: RegionRecord[]): Promise<void>;
}

/**
 * Граф смежности субъектов (ISO → соседние ISO).
 * Наполняется импортом geo-каталога; в рантайме читается только на чтение.
 */
export interface IRegionAdjacencyRepository {
  load(): Promise<Record<string, string[]>>;
}

export interface IPlaceRepository {
  findById(id: string): Promise<PlaceRecord | null>;
  findByFias(fiasId: string): Promise<PlaceRecord | null>;
  findRegionPlaceByRegionId(regionId: string): Promise<PlaceRecord | null>;
  /** Поиск по nameNormalized — legacy. Предпочтителен findByStemInRegion. */
  findByNameInRegion(name: string, regionId: string): Promise<PlaceRecord | null>;
  /**
   * Поиск по name_stem + region_id.
   * preferKind: при коллизии предпочесть place с этим kind (city_district при городском якоре).
   */
  findByStemInRegion(stem: string, regionId: string, preferKind?: PlaceRecord["kind"]): Promise<PlaceRecord | null>;
  /** Global stem search с kindFloor (ADR-012 §2). */
  findByStemGlobal(stem: string, opts: FindByStemGlobalOptions): Promise<PlaceRecord[]>;
  /** Canonical place(kind=region) по ISO субъекта. */
  findRegionPlaceByIso(iso: string): Promise<PlaceRecord | null>;
  /** Все активные places для построения scan index. */
  listScanEntries(): Promise<PlaceScanEntry[]>;
  listActive(): Promise<PlaceRecord[]>;
  upsertMany(places: PlaceRecord[]): Promise<void>;
  mergeContribution(input: PlaceContribution): Promise<{ updated: PlaceRecord; appliedFields: string[] }>;
}

export interface IPlaceAliasRepository {
  findByAlias(aliasNormalized: string): Promise<PlaceAliasRecord[]>;
  listActive(): Promise<PlaceAliasRecord[]>;
  upsertAlias(input: {
    placeId: string;
    alias: string;
    source: "auto" | "manual";
  }): Promise<void>;
  upsertMany(aliases: PlaceAliasRecord[]): Promise<void>;
}

export interface IPlaceCacheRepository {
  get(
    queryNorm: string,
    provider?: PlaceCacheProvider,
  ): Promise<PlaceCacheHit | null>;
  put(
    queryNorm: string,
    provider: PlaceCacheProvider,
    value: Record<string, unknown>,
    meta?: PlaceCachePutMeta,
  ): Promise<void>;
}

export interface IStatusDictionaryRepository {
  listActive(): Promise<StatusDictionaryRecord[]>;
  findByCode(code: string): Promise<StatusDictionaryRecord | null>;
}

export type PlaceEnrichmentProvider = "dadata" | "llm" | "nominatim";
export type PlaceEnrichmentJobStatus = "pending" | "processing" | "done" | "failed";

export type PlaceEnrichmentJobRecord = {
  id: string;
  placeId: string;
  provider: PlaceEnrichmentProvider;
  status: PlaceEnrichmentJobStatus;
  attempts: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
};

export interface IPlaceEnrichmentJobRepository {
  enqueue(placeId: string, provider: PlaceEnrichmentProvider): Promise<void>;
  /** Активные eligible places → pending job (admin warm-up). */
  enqueueCatchUp(provider: PlaceEnrichmentProvider): Promise<{ enqueued: number }>;
  /** Pull batch: фильтр eligible до LIMIT, upsert + claim processing. */
  claimEligibleBatch(
    provider: PlaceEnrichmentProvider,
    limit: number,
  ): Promise<PlaceEnrichmentJobRecord[]>;
  claimBatch(
    provider: PlaceEnrichmentProvider,
    limit: number,
  ): Promise<PlaceEnrichmentJobRecord[]>;
  /** Targeted drain: claim jobs только для указанных place_id. */
  claimForPlaceIds(
    provider: PlaceEnrichmentProvider,
    placeIds: string[],
  ): Promise<PlaceEnrichmentJobRecord[]>;
  markDone(id: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  /** Вернуть processing → pending (инфра-сбой, не ошибка place). */
  releaseToPending(ids: string[]): Promise<number>;
  /** Сброс всех processing → pending для провайдера (сиротский run после рестарта worker). */
  resetProcessingForProvider(provider: PlaceEnrichmentProvider): Promise<number>;
  /** Ручной retry: failed → pending (админка). */
  resetFailedForProvider(provider: PlaceEnrichmentProvider): Promise<number>;
  countByStatus(provider: PlaceEnrichmentProvider): Promise<Record<PlaceEnrichmentJobStatus, number>>;
  clearQueuedWork(provider?: PlaceEnrichmentProvider): Promise<number>;
}

export interface ISyncAuditRepository {
  start(payload: Record<string, unknown>): Promise<{ id: string }>;
  finish(id: string, payload: Record<string, unknown>): Promise<void>;
}
