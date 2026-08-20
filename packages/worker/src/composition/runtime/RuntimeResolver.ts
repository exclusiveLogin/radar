/**
 * ---
 * layer: worker/composition
 * domain: infra/runtime
 * purpose: Фильтрует infra manifest — какие pipeline должны стартовать на текущем worker-role.
 * ---
 */
import type {
  InfraManifest,
  DeploymentPipelineEntry,
  ObsPipelineRuntime,
} from "@radar/shared";
import type { WorkerRole } from "../../infrastructure/config/workerRole.js";

export type ResolvedRuntimePipeline = {
  entry: DeploymentPipelineEntry;
  runtime: ObsPipelineRuntime;
};

export type RuntimeResolverInput = {
  manifest: InfraManifest;
  workerRole: WorkerRole;
};

/** host === workerRole (split roles only). */
export function hostMatchesPipeline(
  pipelineHost: DeploymentPipelineEntry["host"],
  workerRole: WorkerRole,
): boolean {
  return pipelineHost === workerRole;
}

/** Активные pipeline текущего процесса по infra manifest. */
export function resolveRuntimePipelines(
  input: RuntimeResolverInput,
): ResolvedRuntimePipeline[] {
  return input.manifest.runners.pipelines
    .filter((entry) => entry.enabled)
    .filter((entry) => hostMatchesPipeline(entry.host, input.workerRole))
    .map((entry) => ({
      entry,
      runtime: "runner-platform" as const,
    }));
}
