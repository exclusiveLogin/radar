import { WorkerStorageMode } from "../persistence/storageMode.js";
import type { DeploymentInfraObs } from "@radar/shared";

/** Режим observability write-path. */
export type ObsMode = "embedded" | "service" | "noop";

export type ResolvedObsConfig = {
  mode: ObsMode;
  readMode: "embedded" | "service";
  serviceUrl: string;
  port: number;
  host: string;
  staleMs: number;
  staleIntervalMs: number;
};

/** SSOT host_id для worker-процесса на роли. */
export function buildObsHostId(workerRole: string): string {
  return `worker:${workerRole}`;
}

/**
 * Резолвит obs-конфиг из deployment manifest (ADR-021).
 * dockerize/dockerizeAll → service; default embedded при db storage, иначе noop.
 */
export function resolveObsConfig(
  obs: DeploymentInfraObs,
  storageMode: WorkerStorageMode,
): ResolvedObsConfig {
  let mode: ObsMode = obs.mode;
  if (obs.dockerize || obs.dockerizeAll) {
    mode = "service";
  }
  if (storageMode !== WorkerStorageMode.Db && mode === "embedded") {
    mode = "noop";
  }
  return {
    mode,
    readMode: obs.readMode,
    serviceUrl: obs.serviceUrl,
    port: obs.port,
    host: obs.host,
    staleMs: obs.staleMs,
    staleIntervalMs: obs.staleIntervalMs,
  };
}

/** @deprecated Используй resolveObsConfig(manifest.infra.obs, storageMode). */
export function resolveObsModeFromEnv(
  storageMode: WorkerStorageMode,
  _env: NodeJS.ProcessEnv = process.env,
): ObsMode {
  return storageMode === WorkerStorageMode.Db ? "embedded" : "noop";
}

/** @deprecated Используй resolveObsConfig().serviceUrl */
export function resolveObsServiceUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env.RADAR_OBS_SERVICE_URL?.trim();
  return raw && raw.length > 0 ? raw : "http://127.0.0.1:3020";
}
