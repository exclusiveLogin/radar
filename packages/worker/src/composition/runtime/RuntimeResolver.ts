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

/** host=all | host=role | role=all (монолит). */
export function hostMatchesPipeline(
  pipelineHost: DeploymentPipelineEntry["host"],
  workerRole: WorkerRole,
): boolean {
  if (pipelineHost === "all" || workerRole === "all") return true;
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
      schedulingImpl: entry.schedulingImpl,
      runtime:
        entry.schedulingImpl === "runner-platform" ? "runner-platform" : ("legacy" as const),
    }));
}
