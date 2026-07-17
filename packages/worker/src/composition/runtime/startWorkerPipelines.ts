/**
 * ---
 * layer: worker/composition
 * domain: deployment/runtime
 * purpose: Создаёт, запускает и регистрирует launcher активных pipeline.
 * ---
 */
import type { PipelineKey } from "@radar/shared";
import type { PipelineLauncherFactoryDeps } from "./PipelineLauncherFactory.js";
import { createPipelineLauncher } from "./PipelineLauncherFactory.js";
import type { ResolvedRuntimePipeline } from "./RuntimeResolver.js";
import type { WorkerLifecycle } from "../lifecycle/WorkerLifecycle.js";
import type { PipelineLauncherRegistry } from "./PipelineLauncherRegistry.js";
import type { PipelineLauncher } from "../../application/runtime/pipelineLauncher.js";

export type StartWorkerPipelinesDeps = {
  runtimePipelines: readonly ResolvedRuntimePipeline[];
  pipelineKeys: readonly PipelineKey[];
  factoryDeps: PipelineLauncherFactoryDeps;
  launchers: PipelineLauncherRegistry;
  lifecycle: WorkerLifecycle;
};

/** Запускает только доступные и разрешённые manifest pipeline. */
export function startWorkerPipelines(
  deps: StartWorkerPipelinesDeps,
): Partial<Record<PipelineKey, PipelineLauncher>> {
  const started: Partial<Record<PipelineKey, PipelineLauncher>> = {};

  for (const pipelineKey of deps.pipelineKeys) {
    const resolved = deps.runtimePipelines.find(
      (pipeline) => pipeline.entry.pipelineKey === pipelineKey,
    );
    if (!resolved) continue;

    const launcher = createPipelineLauncher(resolved, deps.factoryDeps);
    if (!launcher) continue;

    launcher.start();
    deps.launchers.register(launcher);
    deps.lifecycle.register(() => launcher.stop());
    started[pipelineKey] = launcher;
  }

  return started;
}
