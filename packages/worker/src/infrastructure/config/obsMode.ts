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
 * Резолвит obs-конфиг из infra manifest.
 * dockerize → service; default embedded при db storage, иначе noop.
 */
export function resolveObsConfig(
  obs: DeploymentInfraObs,
  storageMode: WorkerStorageMode,
): ResolvedObsConfig {
  let mode: ObsMode = obs.mode;
  if (obs.dockerize) {
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
