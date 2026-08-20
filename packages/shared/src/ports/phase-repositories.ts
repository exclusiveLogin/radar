/**
 * ---
 * layer: shared/ports
 * bounded-context: phases
 * purpose: Контракты хранения очередей, определений и запусков фаз.
 * ---
 */
import type {
  ManualRunScope,
  PhaseManifestEntry,
  PhasePolicy,
  PhaseScope,
  PhaseTrigger,
  PhaseTriggerMode,
} from "../schemas/enrichment/phase";
import type {
  PhaseRun,
  PhaseRunControl,
  PhaseRunLogEntry,
  PhaseRunStats,
  PhaseRunStatus,
} from "../schemas/enrichment/phase-run";

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
  /** Targeted plan: pending только для указанных materializationIds (raw_message_id). */
  planPendingForIds(phaseId: string, rawMessageIds: string[]): Promise<{ planned: number }>;
  /**
   * Claim pending; при prerequisitePhaseIds — только строки, где все предшествующие фазы done.
   */
  claimBatch(
    phaseId: string,
    limit: number,
    prerequisitePhaseIds?: string[],
  ): Promise<PhaseCoverageTask[]>;
  /** Targeted drain: claim только указанные raw_message_id. */
  claimForRawMessages(
    phaseId: string,
    rawMessageIds: string[],
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
  listEnabled(triggerMode?: PhaseTriggerMode, scope?: PhaseScope): Promise<PhaseDefinitionRecord[]>;
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
