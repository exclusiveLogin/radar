/**
 * SSOT роли worker-процесса (монолит или docker split).
 */
export type WorkerRole = "all" | "ingest" | "backfill" | "parse" | "geo" | "tracking" | "phase";

const VALID_ROLES = new Set<WorkerRole>([
  "all",
  "ingest",
  "backfill",
  "parse",
  "geo",
  "tracking",
  "phase",
]);

export function resolveWorkerRoleFromEnv(env: NodeJS.ProcessEnv = process.env): WorkerRole {
  const raw = env.RADAR_WORKER_ROLE?.trim().toLowerCase();
  if (raw && VALID_ROLES.has(raw as WorkerRole)) return raw as WorkerRole;
  return "all";
}

export function roleRunsLiveIngest(role: WorkerRole): boolean {
  return role === "all" || role === "ingest";
}

export function roleRunsBackfill(role: WorkerRole): boolean {
  return role === "all" || role === "backfill";
}

/** ingestParse daemons (legacy phase = parse+geo together). */
export function roleRunsParseDaemons(role: WorkerRole): boolean {
  return role === "all" || role === "parse" || role === "phase";
}

export function roleRunsGeoDaemons(role: WorkerRole): boolean {
  return role === "all" || role === "geo" || role === "phase";
}

/** @deprecated alias */
export function roleRunsPhaseDaemons(role: WorkerRole): boolean {
  return roleRunsParseDaemons(role) || roleRunsGeoDaemons(role);
}

export function roleRunsTrackingDaemon(role: WorkerRole): boolean {
  return role === "all" || role === "tracking";
}

/** OutboxRelay отключён — RMQ-only. */
export function roleRunsOutboxRelay(_role: WorkerRole): boolean {
  return false;
}

/** Ingest публикует через IEventTransport, не outbox. */
export function rolePublishesIngestToOutbox(_role: WorkerRole): boolean {
  return false;
}

export function roleSubscribesPhaseIngestOnBus(role: WorkerRole): boolean {
  return roleRunsParseDaemons(role);
}
