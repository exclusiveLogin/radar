import type { DomainEvent } from "../schemas/events/domain-event";
import type { EventLocation } from "../schemas/ingest/event-location";
import type {
  CreateIngestBinding,
  CreateIngestProvider,
  IngestBindingRecord,
  IngestProviderRecord,
  UpdateIngestProvider,
} from "../schemas/ingest/ingest-provider";
import type { BackfillJobRecord, CreateBackfillJob } from "../schemas/ingest/ingest-timeline";
import type { ParsedEvent } from "../schemas/ingest/parsed-event";
import type {
  RawMessage,
  RawMessageTelegramExtension,
} from "../schemas/ingest/raw-message";
import type { TimelineQuery } from "../schemas/ingest/ingest-timeline";

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
};

export type PlaceRecord = {
  id: string;
  regionId: string;
  parentPlaceId?: string;
  kind: "district" | "city" | "locality" | "settlement" | "urban_okrug" | "mo_go";
  name: string;
  nameWithType?: string;
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
  alias: string;
  aliasNormalized: string;
  targetKind: "region" | "place";
  regionId?: string;
  placeId?: string;
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

export type PlaceStatusActiveRecord = {
  placeId: string;
  statusCode: string;
  source: "parser" | "operator" | "system";
  startedAt: string;
  updatedAt: string;
  meta?: Record<string, unknown>;
};

export type PlaceStatusHistoryRecord = {
  id: string;
  placeId: string;
  statusCode: string;
  action: "activate" | "deactivate";
  source: "parser" | "operator" | "system";
  eventAt: string;
  meta?: Record<string, unknown>;
};

export type RegionStateActiveRecord = {
  regionId: string;
  regionCode: string;
  /** Эффективный уровень (с учётом соседей) — то, что показывает карта. */
  stateLevel: "grey" | "green" | "yellow" | "orange" | "red";
  /** Собственный уровень региона по его событиям (база для пересчёта propagation). */
  selfLevel: "grey" | "green" | "yellow" | "orange" | "red";
  activity: number;
  reason?: string;
  updatedAt: string;
};

export type PlaceEvidenceRecord = {
  id: string;
  placeId: string;
  provider: PlaceProvider;
  action: "candidate" | "confirm" | "reject" | "enrich";
  confidence?: number;
  payload?: Record<string, unknown>;
  traceId?: string;
  createdAt: string;
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
  findByCode(code: string): Promise<RegionRecord | null>;
  listActive(): Promise<RegionRecord[]>;
  upsertMany(regions: RegionRecord[]): Promise<void>;
}

export interface IPlaceRepository {
  findById(id: string): Promise<PlaceRecord | null>;
  findByFias(fiasId: string): Promise<PlaceRecord | null>;
  findByNameInRegion(name: string, regionId: string): Promise<PlaceRecord | null>;
  listActive(): Promise<PlaceRecord[]>;
  upsertMany(places: PlaceRecord[]): Promise<void>;
  mergeContribution(input: PlaceContribution): Promise<{ updated: PlaceRecord; appliedFields: string[] }>;
}

export interface IPlaceAliasRepository {
  findByAlias(aliasNormalized: string): Promise<PlaceAliasRecord[]>;
  listActive(): Promise<PlaceAliasRecord[]>;
  upsertAlias(input: {
    targetKind: "region" | "place";
    regionId?: string;
    placeId?: string;
    alias: string;
    source: "auto" | "manual";
  }): Promise<void>;
  upsertMany(aliases: PlaceAliasRecord[]): Promise<void>;
}

export type ChannelRecord = {
  id: string;
  key: string;
  telegramTarget: string;
  title?: string | null;
  enabled: boolean;
  parseOverrides: Record<string, unknown>;
  providerId?: string | null;
  bindingId?: string | null;
  sourceKind?: string;
};

export interface IChannelRepository {
  findByKey(key: string): Promise<ChannelRecord | null>;
  findById(id: string): Promise<ChannelRecord | null>;
  upsert(input: {
    key: string;
    telegramTarget: string;
    title?: string | null;
    enabled?: boolean;
    parseOverrides?: Record<string, unknown>;
    providerId?: string | null;
    bindingId?: string | null;
    sourceKind?: string;
  }): Promise<ChannelRecord>;
}

export interface IRawMessageRepository {
  upsert(
    raw: RawMessage,
    extension?: RawMessageTelegramExtension,
  ): Promise<{ inserted: boolean; id: string }>;
  findById(id: string): Promise<RawMessage | null>;
  findByHash(hash: string): Promise<{ id: string; raw: RawMessage } | null>;
  listTimeline(query: TimelineQuery): Promise<{ items: RawMessage[]; nextAnchor: null | {
    channelKey: string;
    postedAtUtc: string;
    tieBreaker: string;
    direction: "before" | "after";
    limit: number;
  } }>;
}

export interface IParsedEventRepository {
  upsert(parsed: ParsedEvent): Promise<{ id: string }>;
}

export interface IEventLocationRepository {
  replaceForParsedEvent(parsedEventId: string, locations: EventLocation[]): Promise<void>;
}

export interface IIngestCursorRepository {
  advanceLive(input: {
    channelKey: string;
    providerKey: string;
    externalMessageId: string;
    postedAt: string;
    sourceSequence?: string | null;
    ingestMode: "live" | "backfill" | "manual";
  }): Promise<void>;
  updateBackfillState(channelKey: string, providerKey: string, state: Record<string, unknown>): Promise<void>;
  get(channelKey: string, providerKey: string): Promise<{
    liveLastExternalId: string | null;
    liveLastPostedAt: string | null;
    liveLastSourceSequence: string | null;
    backfillState: Record<string, unknown>;
    externalCursor: Record<string, unknown>;
  } | null>;
}

export interface IIngestProviderRepository {
  listActive(): Promise<IngestProviderRecord[]>;
  listAll(): Promise<IngestProviderRecord[]>;
  findByKey(key: string): Promise<IngestProviderRecord | null>;
  findById(id: string): Promise<IngestProviderRecord | null>;
  create(input: CreateIngestProvider): Promise<IngestProviderRecord>;
  update(id: string, input: UpdateIngestProvider): Promise<IngestProviderRecord>;
  updateStatus(id: string, status: IngestProviderRecord["status"], lastError?: string | null): Promise<void>;
  touchHeartbeat(id: string): Promise<void>;
}

export interface IIngestBindingRepository {
  listByProvider(providerId: string): Promise<IngestBindingRecord[]>;
  listEnabled(): Promise<IngestBindingRecord[]>;
  findById(id: string): Promise<IngestBindingRecord | null>;
  create(providerId: string, input: CreateIngestBinding): Promise<IngestBindingRecord>;
  updateEnabled(id: string, enabled: boolean): Promise<void>;
}

export interface IIngestBackfillJobRepository {
  create(input: CreateBackfillJob & { providerId: string }): Promise<BackfillJobRecord>;
  findById(id: string): Promise<BackfillJobRecord | null>;
  /** Следующая задача pending или running (resume после рестарта). */
  findRunnable(): Promise<BackfillJobRecord | null>;
  updateStatus(id: string, status: BackfillJobRecord["status"], stats?: BackfillJobRecord["stats"]): Promise<void>;
  updateProgress(
    id: string,
    patch: { stats?: BackfillJobRecord["stats"]; params?: Record<string, unknown> },
  ): Promise<void>;
}

export interface IRawMessageTelegramExtensionRepository {
  findDuplicate(chatId: string, messageId: string, editDate: string | null): Promise<string | null>;
}

export interface IDomainEventOutbox {
  append(events: DomainEvent[]): Promise<void>;
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

export interface IPlaceStatusRepository {
  upsertActive(input: PlaceStatusActiveRecord): Promise<void>;
  deactivate(placeId: string, statusCode: string, atIso: string): Promise<void>;
  listActive(placeId: string): Promise<PlaceStatusActiveRecord[]>;
  /** Активные статусы всех НП внутри региона (каскадный сброс при отбое). */
  listActiveByRegionId(regionId: string): Promise<PlaceStatusActiveRecord[]>;
  /** Все строки place_status_active (для полного сброса перед reparse). */
  listAllActive(): Promise<PlaceStatusActiveRecord[]>;
  /** Активные статусы, не обновлявшиеся с `updatedBefore` (для TTL-сброса). */
  listActiveUpdatedBefore(updatedBeforeIso: string): Promise<PlaceStatusActiveRecord[]>;
}

export interface IRegionStateRepository {
  /** Записывает текущий срез состояния региона (проекция region_state_active). */
  upsert(input: RegionStateActiveRecord): Promise<void>;
  get(regionId: string): Promise<RegionStateActiveRecord | null>;
  listAll(): Promise<RegionStateActiveRecord[]>;
  /** Регионы с `state_level ≠ grey` и `updated_at` старше порога (TTL). */
  listAlarmUpdatedBefore(updatedBeforeIso: string): Promise<RegionStateActiveRecord[]>;
  /** Добавляет запись в историю смен region_state_history. */
  appendHistory(input: {
    regionId: string;
    regionCode: string;
    stateLevel: "grey" | "green" | "yellow" | "orange" | "red";
    previousLevel: "grey" | "green" | "yellow" | "orange" | "red";
    reason?: string;
    changedAt: string;
  }): Promise<void>;
}

export interface IPlaceStatusHistoryRepository {
  append(record: PlaceStatusHistoryRecord): Promise<void>;
  listByPlace(placeId: string, limit: number): Promise<PlaceStatusHistoryRecord[]>;
}

export interface IPlaceEvidenceRepository {
  append(record: PlaceEvidenceRecord): Promise<void>;
  listByPlace(placeId: string, limit: number): Promise<PlaceEvidenceRecord[]>;
}

export interface ISyncAuditRepository {
  start(payload: Record<string, unknown>): Promise<{ id: string }>;
  finish(id: string, payload: Record<string, unknown>): Promise<void>;
}

export interface IDomainEventRepository {
  append(events: DomainEvent[]): Promise<void>;
}
