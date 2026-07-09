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
import type {
  PhaseManifestEntry,
  PhasePolicy,
  PhaseScope,
  PhaseTrigger,
} from "../schemas/enrichment/phase";
import type {
  PhaseRun,
  PhaseRunControl,
  PhaseRunLogEntry,
  PhaseRunStats,
  PhaseRunStatus,
} from "../schemas/enrichment/phase-run";
import type { ManualRunScope } from "../schemas/enrichment/phase";
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

export type ParsedEventRecord = ParsedEvent & { id: string };

export type MessageParseWorkspaceRecord = {
  id: string;
  rawMessageId: string;
  parserRevision: string;
  status: "draft" | "finalized" | "superseded" | "invalid";
  groomedText: string;
  workspace: import("../schemas/parse/parse-workspace.js").ParseWorkspace;
  spawnedEventIds: string[];
  candidateEventMap: Record<string, string>;
  finalizedAt?: string;
  createdAt: string;
};

export interface IParsedEventRepository {
  upsert(parsed: ParsedEvent): Promise<{ id: string }>;
  /** Legacy: первый event по raw (DESC parsed_at). */
  findByRawMessageId(rawMessageId: string): Promise<ParsedEventRecord | null>;
  findAllByRawMessageId(rawMessageId: string): Promise<ParsedEventRecord[]>;
  upsertById(id: string | undefined, parsed: ParsedEvent): Promise<{ id: string }>;
  deactivateById(id: string, inactiveReason?: string): Promise<void>;
  hardDeleteById(id: string): Promise<void>;
}

export interface IMessageParseWorkspaceRepository {
  findActiveByRawMessageId(rawMessageId: string): Promise<MessageParseWorkspaceRecord | null>;
  supersedeActiveForRaw(rawMessageId: string): Promise<void>;
  saveFinalized(input: {
    rawMessageId: string;
    parserRevision: string;
    groomedText: string;
    workspace: MessageParseWorkspaceRecord["workspace"];
    spawnedEventIds: string[];
    candidateEventMap: Record<string, string>;
  }): Promise<MessageParseWorkspaceRecord>;
}

export interface IEventLocationRepository {
  replaceForParsedEvent(parsedEventId: string, locations: EventLocation[]): Promise<void>;
  /** Локации до replace — для снятия place_status при LLM other. */
  listForParsedEvent(parsedEventId: string): Promise<EventLocation[]>;
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

export type BackfillJobFilter = {
  status?: BackfillJobRecord["status"];
  bindingId?: string;
  limit?: number;
};

export interface IIngestBackfillJobRepository {
  create(input: CreateBackfillJob & { providerId: string }): Promise<BackfillJobRecord>;
  findById(id: string): Promise<BackfillJobRecord | null>;
  /** Список задач для мониторинга (order createdAt DESC), с фильтром по статусу/binding. */
  findMany(filter?: BackfillJobFilter): Promise<BackfillJobRecord[]>;
  /** Следующая задача pending или running (resume после рестарта). */
  findRunnable(): Promise<BackfillJobRecord | null>;
  /** Все активные задачи для round-robin (стабильный порядок createdAt ASC). */
  findRunnableMany(limit?: number): Promise<BackfillJobRecord[]>;
  updateStatus(id: string, status: BackfillJobRecord["status"], stats?: BackfillJobRecord["stats"]): Promise<void>;
  /** Запросить отмену: pending/running → canceled (демон прервёт стрим). */
  requestCancel(id: string): Promise<BackfillJobRecord | null>;
  updateProgress(
    id: string,
    patch: { stats?: BackfillJobRecord["stats"]; params?: Record<string, unknown> },
  ): Promise<void>;
  /** Пульс для админки: обновляет updated_at без смены stats/params. */
  touch(id: string): Promise<void>;
}

/** Запись технического следа парсинга (log_parse_attempt). */
export type ParseAttemptInput = {
  rawMessageId: string;
  channelKey: string | null;
  parserVersion: string;
  status: "ok" | "failed" | "skipped";
  errors?: Record<string, unknown> | null;
};

export interface IParseAttemptRepository {
  append(input: ParseAttemptInput): Promise<void>;
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

export type EventEvidenceRecord = {
  id: string;
  eventId: string;
  eventType: string;
  placeId: string;
  observedAt: string;
  timeBucket15m: string;
  providerKind: string;
  sourceProviderId?: string;
  sourceChannelKey?: string;
  sourceMessageId?: string;
  traceId?: string;
  payload: Record<string, unknown>;
  trustScore?: number;
  createdAt: string;
};

export interface IEventEvidenceRepository {
  append(record: EventEvidenceRecord): Promise<void>;
}

export interface ISyncAuditRepository {
  start(payload: Record<string, unknown>): Promise<{ id: string }>;
  finish(id: string, payload: Record<string, unknown>): Promise<void>;
}

export interface IDomainEventRepository {
  append(events: DomainEvent[]): Promise<void>;
}

/** Статус покрытия сообщения фазой. */
export type PhaseCoverageStatus = "pending" | "processing" | "done" | "failed";

/** Строка queue_parse_coverage: фаза X для raw_message. */
export type PhaseCoverageTask = {
  id: string;
  rawMessageId: string;
  phaseId: string;
  parsedEventId: string | null;
  status: PhaseCoverageStatus;
  attempts: number;
  lastError?: string;
  processedAt?: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Покрытие per-phase (ADR-003 v2): `(raw_message_id, phase_id)`.
 * Enqueue идемпотентен — done не сбрасывается.
 */
export interface IPhaseCoverageRepository {
  enqueuePending(input: {
    rawMessageId: string;
    phaseId: string;
    parsedEventId?: string | null;
  }): Promise<void>;
  /** Catch-up: pending для всех raw без done по фазе. */
  enqueueCatchUp(phaseId: string): Promise<{ enqueued: number }>;
  /**
   * Claim pending; при prerequisitePhaseIds — только строки, где все предшествующие фазы done.
   */
  claimBatch(
    phaseId: string,
    limit: number,
    prerequisitePhaseIds?: string[],
  ): Promise<PhaseCoverageTask[]>;
  markDone(id: string): Promise<void>;
  /** Пометить done по паре (после inline eager без claim). */
  markDoneForMessage(rawMessageId: string, phaseId: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  /** Сброс processing → pending для force-kill run. */
  resetProcessingForPhase(phaseId: string): Promise<number>;
  /**
   * Удалить необработанную очередь (pending + processing).
   * done/failed не трогает — повторный catch-up не поднимет уже обработанное.
   */
  clearQueuedWork(phaseIds?: string[]): Promise<number>;
  invalidateForPhases(phaseIds: string[]): Promise<number>;
  countByStatus(phaseId?: string): Promise<Record<PhaseCoverageStatus, number>>;
}

/** @deprecated Используйте IPhaseCoverageRepository */
export type EnrichmentTaskStatus = PhaseCoverageStatus;
/** @deprecated Используйте PhaseCoverageTask */
export type EnrichmentTask = PhaseCoverageTask & { stage: string };
/** @deprecated Используйте IPhaseCoverageRepository */
export type IEnrichmentQueueRepository = IPhaseCoverageRepository;

/** Запись фазы из БД. */
export type PhaseDefinitionRecord = PhaseManifestEntry & { updatedAt: string };

export interface IPhaseDefinitionRepository {
  listAll(): Promise<PhaseDefinitionRecord[]>;
  listEnabled(trigger?: PhaseTrigger, scope?: PhaseScope): Promise<PhaseDefinitionRecord[]>;
  findById(id: string): Promise<PhaseDefinitionRecord | null>;
  upsert(entry: PhaseManifestEntry): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  updatePolicy(id: string, policy: Partial<PhasePolicy>): Promise<void>;
}

export type PhaseRunFilter = {
  phaseId?: string;
  status?: PhaseRunStatus;
  trigger?: PhaseTrigger;
  limit?: number;
};

export interface IPhaseRunRepository {
  create(input: {
    phaseId: string;
    trigger: PhaseTrigger;
    status?: PhaseRunStatus;
  }): Promise<PhaseRun>;
  findById(id: string): Promise<PhaseRun | null>;
  /** Активный запуск фазы (running или pending) — для исключения параллельных drain. */
  findActiveForPhase(phaseId: string): Promise<PhaseRun | null>;
  /** Зависшие running (рестарт воркера) → failed. */
  failStaleActiveRuns(phaseId: string, staleAfterMs: number): Promise<number>;
  listActive(): Promise<PhaseRun[]>;
  list(filter?: PhaseRunFilter): Promise<PhaseRun[]>;
  appendLog(id: string, entry: PhaseRunLogEntry): Promise<void>;
  updateStats(id: string, stats: PhaseRunStats): Promise<void>;
  requestControl(id: string, control: PhaseRunControl): Promise<void>;
  clearControl(id: string): Promise<void>;
  getControl(id: string): Promise<PhaseRunControl | null>;
  updateStatus(
    id: string,
    status: PhaseRunStatus,
    patch?: { stats?: PhaseRunStats; error?: string | null },
  ): Promise<void>;
  /** Сообщения для manual run с опциональным scope. */
  findRawIdsForManualRun(phaseId: string, scope?: ManualRunScope): Promise<string[]>;
}

