import { BehaviorSubject } from "rxjs";
import type {
  AdminTelemetry,
  BackfillJobListItem,
  ChannelAdminItem,
  ChannelStats,
  ParseAttemptItem,
  PhasesUpdatePayload,
  PhaseRun,
  PhaseRunsOverview,
  StatsOverview,
} from "@radar/shared";
import { adminApi } from "../api/adminApi";
import { connectAdminWs } from "../realtime/adminWs";
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

const CHANNELS_POLL_MS = 30_000;
const STATS_POLL_MS = 30_000;
const TELEMETRY_POLL_MS = 10_000;
const BACKFILL_POLL_MS = 15_000;
const PARSE_LOG_CAP = 200;

let started = false;

/** Однократная инициализация админ-сторов: REST-поллинг + realtime admin-WS. */
export function startAdminStore(): void {
  if (started) return;
  started = true;

  void refreshChannels();
  void refreshStats();
  void refreshTelemetry();
  void refreshBackfill();
  void seedParseLog();

  setInterval(() => void refreshChannels(), CHANNELS_POLL_MS);
  setInterval(() => void refreshStats(), STATS_POLL_MS);
  setInterval(() => void refreshTelemetry(), TELEMETRY_POLL_MS);
  setInterval(() => void refreshBackfill(), BACKFILL_POLL_MS);

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
    }
  });
}

/** Принудительное обновление backfill-задач (после создания/отмены). */
export async function refreshBackfill(): Promise<void> {
  try {
    backfillJobs$.next(await adminApi.backfillJobs({ limit: 50 }));
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
    parseLog$.next(await adminApi.parseAttempts({ limit: 100 }));
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

function prependParseLog(item: ParseAttemptItem): void {
  const next = [item, ...parseLog$.value.filter((row) => row.id !== item.id)];
  parseLog$.next(next.slice(0, PARSE_LOG_CAP));
}

function upsertBackfillJob(job: BackfillJobListItem): void {
  const rest = backfillJobs$.value.filter((row) => row.id !== job.id);
  backfillJobs$.next([job, ...rest]);
}

function applyPhasesUpdate(payload: PhasesUpdatePayload): void {
  phasesOverview$.next(payload.overview);
  phaseRuns$.next(payload.runs);
}
