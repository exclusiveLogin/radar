/**
 * SSOT роли worker-процесса (монолит или docker split).
 * `all` — поведение по умолчанию (один процесс на хосте).
 */
export type WorkerRole = "all" | "ingest" | "backfill" | "phase" | "tracking";

const VALID_ROLES = new Set<WorkerRole>(["all", "ingest", "backfill", "phase", "tracking"]);

/** Читает RADAR_WORKER_ROLE из env; невалидное значение → `all`. */
export function resolveWorkerRoleFromEnv(env: NodeJS.ProcessEnv = process.env): WorkerRole {
  const raw = env.RADAR_WORKER_ROLE?.trim().toLowerCase();
  if (raw && VALID_ROLES.has(raw as WorkerRole)) {
    return raw as WorkerRole;
  }
  return "all";
}

export function roleRunsLiveIngest(role: WorkerRole): boolean {
  return role === "all" || role === "ingest";
}

export function roleRunsBackfill(role: WorkerRole): boolean {
  return role === "all" || role === "backfill";
}

export function roleRunsPhaseDaemons(role: WorkerRole): boolean {
  return role === "all" || role === "phase";
}

export function roleRunsTrackingDaemon(role: WorkerRole): boolean {
  return role === "all" || role === "tracking";
}

/** OutboxRelay нужен phase-worker (cross-process) и монолиту (события API). */
export function roleRunsOutboxRelay(role: WorkerRole): boolean {
  return role === "all" || role === "phase";
}

/** Ingest/backfill пишут RawMessageIngested в domain_events вместо in-process phase subscriber. */
export function rolePublishesIngestToOutbox(role: WorkerRole): boolean {
  return role === "ingest" || role === "backfill";
}

/** Подписчик phaseIngest на in-process bus (монолит или phase-worker через OutboxRelay). */
export function roleSubscribesPhaseIngestOnBus(role: WorkerRole): boolean {
  return role === "all" || role === "phase";
}
