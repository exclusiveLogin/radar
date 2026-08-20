/**
 * ---
 * layer: shared/ports
 * bounded-context: ingest
 * purpose: Контракты хранения источников, сообщений и результатов парсинга.
 * ---
 */
import type { EventLocation } from "../schemas/ingest/event-location";
import type {
  CreateIngestBinding,
  CreateIngestProvider,
  IngestBindingRecord,
  IngestProviderRecord,
  UpdateIngestProvider,
} from "../schemas/ingest/ingest-provider";
import type { BackfillJobRecord, CreateBackfillJob, TimelineQuery } from "../schemas/ingest/ingest-timeline";
import type { ParsedEvent } from "../schemas/ingest/parsed-event";
import type { RawMessage, RawMessageTelegramExtension } from "../schemas/ingest/raw-message";
import type { ParseWorkspace } from "../schemas/parse/parse-workspace.js";

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
  workspace: ParseWorkspace;
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
  /** Upsert по binding_id: один слот на канал, повторный старт сбрасывает задачу. */
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
  /** Удалить job из очереди мониторинга (строка job_ingest_backfill). */
  delete(id: string): Promise<boolean>;
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
