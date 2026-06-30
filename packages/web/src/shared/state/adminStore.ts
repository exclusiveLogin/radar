import { BehaviorSubject } from "rxjs";
import type {
  AdminTelemetry,
  BackfillJobListItem,
  ChannelAdminItem,
  ChannelStats,
  ParseAttemptItem,
  PhasesUpdatePayload,
  ParsePipelineStatusResponse,
  PhaseRun,
  PhaseRunsOverview,
  StatsOverview,
  TrackingStatusResponse,
} from "@radar/shared";
import {
  computeBackfillPercentApprox,
  mergeBackfillPercentMonotonic,
  pickFurtherCheckpointOffsetId,
} from "@radar/shared";
import { adminApi } from "../api/adminApi";
import { connectAdminWs } from "../realtime/adminWs";
import { startIntervalPoll } from "../rx/startIntervalPoll";
import { reportAppError } from "./appLogStore";
import { selectedChannelKey$ } from "./channelSelectionStore";

/** Каналы со статусом «слушается». */
export const channels$ = new BehaviorSubject<ChannelAdminItem[]>([]);
/** Глобальные агрегаты для дашборда. */
export const statsOverview$ = new BehaviorSubject<StatsOverview | null>(null);
/** Телеметрия процессов API+worker. */
export const telemetry$ = new BehaviorSubject<AdminTelemetry | null>(null);
/** Backfill-задачи (мониторинг). */
export const backfillJobs$ = new BehaviorSubject<BackfillJobListItem[]>([]);
/** Лента parse_attempts (realtime + начальная подгрузка). */
export const parseLog$ = new BehaviorSubject<ParseAttemptItem[]>([]);
/** Статистика выбранного канала (контекст из channelSelectionStore). */
export const selectedChannelStats$ = new BehaviorSubject<ChannelStats | null>(null);
/** Overview фаз (realtime через WS phases-update). */
export const phasesOverview$ = new BehaviorSubject<PhaseRunsOverview | null>(null);
/** Последние запуски фаз (realtime через WS phases-update). */
export const phaseRuns$ = new BehaviorSubject<PhaseRun[]>([]);
/** Статус пайплайна треков (WS tracking-status). */
export const trackingStatus$ = new BehaviorSubject<TrackingStatusResponse | null>(null);
/** Статус parse reset/reparse (WS parse-pipeline-status). */
export const parsePipelineStatus$ = new BehaviorSubject<ParsePipelineStatusResponse | null>(null);

const CHANNELS_POLL_MS = 30_000;
const STATS_POLL_MS = 30_000;
const TELEMETRY_POLL_MS = 10_000;
const BACKFILL_POLL_MS = 5_000;
const TRACKING_POLL_MS = 3_000;

/** Макс. строк лога парсинга в памяти (кольцевой буфер / REST limit DESC). */
export const PARSE_LOG_LIMIT = 100;

let started = false;

/** Однократная инициализация админ-сторов: REST-поллинг + realtime admin-WS. */
export function startAdminStore(): void {
  if (started) return;
  started = true;

  void seedParseLog();

  startIntervalPoll(CHANNELS_POLL_MS, refreshChannels);
  startIntervalPoll(STATS_POLL_MS, refreshStats);
  startIntervalPoll(TELEMETRY_POLL_MS, refreshTelemetry);
  startIntervalPoll(BACKFILL_POLL_MS, refreshBackfill);
  startIntervalPoll(TRACKING_POLL_MS, refreshTrackingStatus);
  void refreshTrackingStatus();
  void refreshParsePipelineStatus();

  selectedChannelKey$.subscribe((key) => void refreshChannelStats(key));

  connectAdminWs().subscribe((message) => {
    if (message.type === "worker-status") {
      patchTelemetryWorker(message.payload);
    } else if (message.type === "parse-log") {
      prependParseLog(message.payload);
    } else if (message.type === "backfill-progress") {
      upsertBackfillJob(message.payload);
    } else if (message.type === "phases-update") {
      applyPhasesUpdate(message.payload);
    } else if (message.type === "tracking-status") {
      trackingStatus$.next(message.payload);
    } else if (message.type === "parse-pipeline-status") {
      parsePipelineStatus$.next(message.payload);
    }
  });
}

/** Принудительное обновление backfill-задач (после создания/отмены). */
export async function refreshBackfill(): Promise<void> {
  try {
    const incoming = await adminApi.backfillJobs({ limit: 50 });
    const prevById = new Map(backfillJobs$.value.map((row) => [row.id, row]));
    backfillJobs$.next(incoming.map((row) => mergeBackfillJob(prevById.get(row.id), row)));
  } catch (error) {
    reportAppError("Backfill", error);
  }
}

/** Принудительное обновление списка каналов. */
export async function refreshChannels(): Promise<void> {
  try {
    channels$.next(await adminApi.channels());
  } catch (error) {
    reportAppError("Каналы", error);
  }
}

async function refreshStats(): Promise<void> {
  try {
    statsOverview$.next(await adminApi.statsOverview());
  } catch (error) {
    reportAppError("Сводка", error);
  }
}

async function refreshTelemetry(): Promise<void> {
  try {
    telemetry$.next(await adminApi.telemetry());
  } catch (error) {
    reportAppError("Телеметрия", error);
  }
}

async function seedParseLog(): Promise<void> {
  try {
    parseLog$.next(trimParseLogRing(await adminApi.parseAttempts({ limit: PARSE_LOG_LIMIT })));
  } catch (error) {
    reportAppError("Лог парсинга", error);
  }
}

async function refreshChannelStats(channelKey: string | null): Promise<void> {
  if (!channelKey) {
    selectedChannelStats$.next(null);
    return;
  }
  try {
    selectedChannelStats$.next(await adminApi.channelStats(channelKey));
  } catch (error) {
    reportAppError("Статистика канала", error);
    selectedChannelStats$.next(null);
  }
}

function patchTelemetryWorker(worker: AdminTelemetry["worker"]): void {
  const current = telemetry$.value;
  if (!current) return;
  telemetry$.next({ ...current, worker, capturedAt: new Date().toISOString() });
}

/** Новые сверху, не больше PARSE_LOG_LIMIT (DESC по createdAt). */
function trimParseLogRing(items: ParseAttemptItem[]): ParseAttemptItem[] {
  return items.slice(0, PARSE_LOG_LIMIT);
}

function prependParseLog(item: ParseAttemptItem): void {
  const next = [item, ...parseLog$.value.filter((row) => row.id !== item.id)];
  parseLog$.next(trimParseLogRing(next));
}

/** Берём более свежий updatedAt (touch heartbeat не всегда меняет stats). */
function pickNewerIso(a: string, b: string): string {
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

function mergeBackfillJob(
  prev: BackfillJobListItem | undefined,
  next: BackfillJobListItem,
): BackfillJobListItem {
  if (!prev) return next;

  const p = prev.progress;
  const n = next.progress;
  const checkpointOffsetId = pickFurtherCheckpointOffsetId(
    next.params,
    p.checkpointOffsetId,
    n.checkpointOffsetId,
  );
  const percentFromCheckpoint = computeBackfillPercentApprox(
    next.strategy,
    next.params,
    checkpointOffsetId,
  );

  return {
    ...next,
    updatedAt: pickNewerIso(prev.updatedAt, next.updatedAt),
    progress: {
      ...n,
      inserted: Math.max(n.inserted, p.inserted),
      duplicates: Math.max(n.duplicates, p.duplicates),
      parsed: Math.max(n.parsed, p.parsed),
      checkpointOffsetId,
      checkpointPostedAt:
        checkpointOffsetId === n.checkpointOffsetId
          ? (n.checkpointPostedAt ?? p.checkpointPostedAt)
          : (p.checkpointPostedAt ?? n.checkpointPostedAt),
      boundsMinId: n.boundsMinId ?? p.boundsMinId,
      boundsMaxId: n.boundsMaxId ?? p.boundsMaxId,
      percentApprox: mergeBackfillPercentMonotonic(
        mergeBackfillPercentMonotonic(p.percentApprox, n.percentApprox),
        percentFromCheckpoint,
      ),
    },
  };
}

function upsertBackfillJob(job: BackfillJobListItem): void {
  const idx = backfillJobs$.value.findIndex((row) => row.id === job.id);
  const prev = idx >= 0 ? backfillJobs$.value[idx] : undefined;
  const merged = mergeBackfillJob(prev, job);
  if (idx < 0) {
    backfillJobs$.next([...backfillJobs$.value, merged]);
    return;
  }
  const next = [...backfillJobs$.value];
  next[idx] = merged;
  backfillJobs$.next(next);
}

function applyPhasesUpdate(payload: PhasesUpdatePayload): void {
  phasesOverview$.next(payload.overview);
  phaseRuns$.next(payload.runs);
}

export async function refreshTrackingStatus(): Promise<void> {
  try {
    trackingStatus$.next(await adminApi.trackingGetStatus());
  } catch (error) {
    reportAppError("Треки", error);
  }
}

export async function refreshParsePipelineStatus(): Promise<void> {
  try {
    parsePipelineStatus$.next(await adminApi.parsePipelineGetStatus());
  } catch (error) {
    reportAppError("Parse pipeline", error);
  }
}
