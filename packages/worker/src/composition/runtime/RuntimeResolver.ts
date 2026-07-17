/**
 * ---
 * layer: worker/composition
 * domain: deployment/runtime
 * purpose: Фильтрует deployment manifest — какие pipeline должны стартовать на текущем worker-role.
 * ---
 */
import type {
  DeploymentManifest,
  DeploymentPipelineEntry,
  ObsPipelineRuntime,
  SchedulingImpl,
} from "@radar/shared";
import type { WorkerRole } from "../../infrastructure/config/workerRole.js";

export type ResolvedRuntimePipeline = {
  entry: DeploymentPipelineEntry;
  runtime: ObsPipelineRuntime;
  schedulingImpl: SchedulingImpl;
};

export type RuntimeResolverInput = {
  manifest: DeploymentManifest;
  workerRole: WorkerRole;
};

/** host === workerRole (split roles only). */
export function hostMatchesPipeline(
  pipelineHost: DeploymentPipelineEntry["host"],
  workerRole: WorkerRole,
): boolean {
  return pipelineHost === workerRole;
}

/** Активные pipeline текущего процесса по deployment manifest. */
export function resolveRuntimePipelines(
  input: RuntimeResolverInput,
): ResolvedRuntimePipeline[] {
  return input.manifest.runners.pipelines
    .filter((entry) => entry.enabled)
    .filter((entry) => hostMatchesPipeline(entry.host, input.workerRole))
    .map((entry) => ({
      entry,
      schedulingImpl: "runner-platform" as const,
      runtime: "runner-platform" as const,
    }));
}
