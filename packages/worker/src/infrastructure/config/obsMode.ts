import { WorkerStorageMode } from "../persistence/storageMode.js";

/** Режим observability write-path. */
export type ObsMode = "embedded" | "service" | "noop";

const VALID_MODES = new Set<ObsMode>(["embedded", "service", "noop"]);

/** SSOT host_id для worker-процесса на роли. */
export function buildObsHostId(workerRole: string): string {
  return `worker:${workerRole}`;
}

function envTruthy(name: string, env: NodeJS.ProcessEnv): boolean {
  const raw = env[name];
  if (!raw) return false;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

/** SSOT URL obs-service. */
export function resolveObsServiceUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env.RADAR_OBS_SERVICE_URL?.trim();
  return raw && raw.length > 0 ? raw : "http://127.0.0.1:3020";
}

/**
 * RADAR_OBS_MODE=embedded|service|noop.
 * DOCKERIZE_OBS / DOCKERIZE_ALL → service.
 * Default: embedded при db storage, noop иначе.
 */
export function resolveObsModeFromEnv(
  storageMode: WorkerStorageMode,
  env: NodeJS.ProcessEnv = process.env,
): ObsMode {
  if (envTruthy("DOCKERIZE_OBS", env) || envTruthy("DOCKERIZE_ALL", env)) {
    return "service";
  }
  const raw = env.RADAR_OBS_MODE?.trim().toLowerCase();
  if (raw && VALID_MODES.has(raw as ObsMode)) {
    return raw as ObsMode;
  }
  return storageMode === WorkerStorageMode.Db ? "embedded" : "noop";
}
