import { BehaviorSubject } from "rxjs";
import { mapApi, type IngestProvider } from "../api/mapApi";
import { startIntervalPoll } from "../rx/startIntervalPoll";
import {
  healthResponseSchema,
  readyResponseSchema,
  workerStatusResponseSchema,
  type WorkerStatusResponse,
} from "@radar/shared";
import { reportAppError } from "./appLogStore";

/** Список ingest-провайдеров (каналы). */
export const providers$ = new BehaviorSubject<IngestProvider[]>([]);

/** Статус API health/ready. */
export type SystemHealth = {
  apiOk: boolean;
  dbReady: boolean;
  lastCheckAt: string | null;
};

export const systemHealth$ = new BehaviorSubject<SystemHealth>({
  apiOk: false,
  dbReady: false,
  lastCheckAt: null,
});

/** Probe worker через GET /api/worker/status. */
export const workerStatus$ = new BehaviorSubject<WorkerStatusResponse | null>(null);

const POLL_MS = 30_000;
let started = false;

/** Периодический опрос провайдеров, health/ready и worker probe. */
export function startProvidersStore(): void {
  if (started) return;
  started = true;

  startIntervalPoll(POLL_MS, refreshAll);
}

async function refreshAll(): Promise<void> {
  await Promise.all([refreshProviders(), refreshHealth(), refreshWorkerStatus()]);
}

async function refreshProviders(): Promise<void> {
  try {
    const list = await mapApi.providers();
    providers$.next(list);
  } catch (error) {
    reportAppError("Каналы", error);
    providers$.next([]);
  }
}

async function refreshHealth(): Promise<void> {
  let apiOk = false;
  let dbReady = false;

  try {
    const health = await mapApi.health();
    healthResponseSchema.parse(health);
    apiOk = true;
  } catch {
    /* API недоступен */
  }

  try {
    const ready = await mapApi.ready();
    readyResponseSchema.parse(ready);
    dbReady = true;
  } catch {
    /* БД не готова */
  }

  systemHealth$.next({
    apiOk,
    dbReady,
    lastCheckAt: new Date().toISOString(),
  });
}

async function refreshWorkerStatus(): Promise<void> {
  try {
    const status = await mapApi.workerStatus();
    workerStatus$.next(workerStatusResponseSchema.parse(status));
  } catch (error) {
    reportAppError("Worker", error, "Статус worker недоступен");
    workerStatus$.next(null);
  }
}
