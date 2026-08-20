/** Роли отдельных worker-процессов в host dev-стеке. */
export const DEV_WORKER_ROLES = ["ingest", "backfill", "parse", "geo", "tracking"];

/** Роль, которой нужен free probe-port перед стартом. */
export const DEV_WORKER_PROBE_ROLE = "ingest";

/** concurrently -c для workers (порядок = DEV_WORKER_ROLES). */
export const DEV_WORKER_COLORS = ["green", "yellow", "red", "white", "gray"];

if (DEV_WORKER_COLORS.length !== DEV_WORKER_ROLES.length) {
  throw new Error("DEV_WORKER_COLORS must match DEV_WORKER_ROLES length");
}

export function devWorkerProcessNames() {
  return DEV_WORKER_ROLES.map((role) => `worker-${role}`);
}
