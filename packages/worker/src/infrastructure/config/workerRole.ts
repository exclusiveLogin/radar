/**
 * SSOT роли worker-процесса (docker split / RADAR_WORKER_ROLE).
 * Monolith `all` / legacy `phase` удалены — роль обязательна.
 */
export type WorkerRole = "ingest" | "backfill" | "parse" | "geo" | "tracking";

/** Capability домена, которую поднимает boot (обычно = role). */
export type DomainCap = WorkerRole;

const VALID_ROLES = new Set<WorkerRole>([
  "ingest",
  "backfill",
  "parse",
  "geo",
  "tracking",
]);

/** Fail-fast: без валидной RADAR_WORKER_ROLE процесс не стартует. */
export function resolveWorkerRoleFromEnv(env: NodeJS.ProcessEnv = process.env): WorkerRole {
  const raw = env.RADAR_WORKER_ROLE?.trim().toLowerCase();
  if (raw && VALID_ROLES.has(raw as WorkerRole)) return raw as WorkerRole;
  const allowed = [...VALID_ROLES].join(", ");
  throw new Error(
    `RADAR_WORKER_ROLE is required (one of: ${allowed}). Got: ${raw ? JSON.stringify(raw) : "<empty>"}.`,
  );
}

/** Caps процесса: по умолчанию ровно одна = role. CLI может расширить через bootCaps. */
export function capsFor(role: WorkerRole, bootCaps?: readonly DomainCap[]): ReadonlySet<DomainCap> {
  if (bootCaps && bootCaps.length > 0) return new Set(bootCaps);
  return new Set<DomainCap>([role]);
}

export function hasCap(caps: ReadonlySet<DomainCap>, cap: DomainCap): boolean {
  return caps.has(cap);
}

/** OutboxRelay отключён — RMQ-only. */
export function roleRunsOutboxRelay(_role: WorkerRole): boolean {
  return false;
}

/** Ingest публикует через IEventTransport, не outbox. */
export function rolePublishesIngestToOutbox(_role: WorkerRole): boolean {
  return false;
}