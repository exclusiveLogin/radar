import {
  DEFAULT_WORKER_RUNTIME_MANIFEST,
  workerRuntimeManifestSchema,
  type WorkerRuntimeManifest,
} from "./workerRuntime.schema.js";
import { loadDomainManifest } from "../loadDomainManifest.js";

export type LoadWorkerRuntimeManifestOptions = {
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
};

/** Загрузка worker.runtime.manifest.json + WORKER__ env overlay. */
export function loadWorkerRuntimeManifest(
  options: LoadWorkerRuntimeManifestOptions,
): WorkerRuntimeManifest {
  return loadDomainManifest<WorkerRuntimeManifest>({
    repoRoot: options.repoRoot,
    env: options.env,
    fileBase: "worker.runtime",
    envPrefix: "WORKER",
    schema: workerRuntimeManifestSchema,
    defaults: DEFAULT_WORKER_RUNTIME_MANIFEST,
  });
}

export {
  DEFAULT_WORKER_RUNTIME_MANIFEST,
  type WorkerRuntimeManifest,
} from "./workerRuntime.schema.js";
