import type { DomainCap, WorkerRole } from "../infrastructure/config/workerRole.js";
import type { WorkerCompositionOptions } from "../application/createWorkerCompositionRoot.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";

/** Опции композиции для CLI: role + caps, без daemon auto-start. */
export function cliWorkerRuntime(
  workerRole: WorkerRole,
  bootCaps?: readonly DomainCap[],
  extra?: Omit<
    WorkerCompositionOptions,
    "storageMode" | "startIngestParseDaemon" | "workerRole" | "bootCaps"
  >,
): WorkerCompositionOptions {
  return {
    storageMode: WorkerStorageMode.Db,
    startIngestParseDaemon: false,
    workerRole,
    bootCaps: bootCaps ? [...bootCaps] : undefined,
    ...extra,
  };
}
