/**
 * ---
 * layer: worker/composition
 * domain: deployment/runtime
 * purpose: Фабрика PipelineLauncher — runner-platform workload only (ADR-025).
 * ---
 */
import type { DataSource } from "typeorm";
import type { IObservabilityRecorder, PipelineKey } from "@radar/shared";
import type { WorkerRuntimeManifest } from "@radar/shared/manifest/domains/workerRuntime.loader.js";
import {
  createWorkloadObsConfig,
  type WorkloadObsContext,
} from "../../application/runtime/observability/workloadObsHooks.js";
import type { PhasePlatformDeps } from "../../application/runtime/runner-platform/phasePlatformDeps.js";
import { ParseRunnerRegistry } from "../../application/parse/runner/parseRunnerRegistry.js";
import { GeoRunnerRegistry } from "../../application/geo-parse/runner/geoRunnerRegistry.js";
import { createTrackingRunner } from "../../application/tracking/runner/trackingRunner.js";
import type { Workload } from "../../application/runtime/workload/createWorkload.js";
import type { PipelineLauncher } from "../../application/runtime/pipelineLauncher.js";
import type { ResolvedRuntimePipeline } from "./RuntimeResolver.js";

export type PipelineLauncherFactoryDeps = {
  dataSource: DataSource;
  /** Platform ports для parse/geo; tracking использует только dataSource. */
  phasePlatform?: PhasePlatformDeps;
  obsBinding?: { recorder: IObservabilityRecorder; hostId: string };
  workerRuntime: WorkerRuntimeManifest;
};

class RunnerPlatformLauncher implements PipelineLauncher {
  readonly runtime = "runner-platform" as const;

  constructor(
    readonly pipelineKey: PipelineKey,
    private readonly workload: Workload,
  ) {}

  start(): void {
    this.workload.start();
  }

  stop(): void {
    this.workload.stop();
  }

  enqueue(): void {
    this.workload.enqueue();
  }
}

class ParseRunnerLauncher implements PipelineLauncher {
  readonly pipelineKey = "parse" as const;
  readonly runtime = "runner-platform" as const;

  constructor(private readonly registry: ParseRunnerRegistry) {}

  start(): void {
    this.registry.start();
  }

  async stop(): Promise<void> {
    await this.registry.stop();
  }

  enqueue(): void {
    this.registry.enqueueAll();
  }
}

class GeoRunnerLauncher implements PipelineLauncher {
  readonly pipelineKey = "geo-enrich" as const;
  readonly runtime = "runner-platform" as const;

  constructor(private readonly registry: GeoRunnerRegistry) {}

  start(): void {
    this.registry.start();
  }

  async stop(): Promise<void> {
    await this.registry.stop();
  }

  enqueue(): void {
    this.registry.enqueueAll();
  }
}

function obsCtxFor(
  deps: PipelineLauncherFactoryDeps,
  pipelineKey: PipelineKey,
): WorkloadObsContext | undefined {
  if (!deps.obsBinding) return undefined;
  return {
    recorder: deps.obsBinding.recorder,
    hostId: deps.obsBinding.hostId,
    pipelineKey,
    runtime: "runner-platform",
  };
}

/** Создаёт runner-platform launcher; null если порты недоступны. */
export function createPipelineLauncher(
  resolved: ResolvedRuntimePipeline,
  deps: PipelineLauncherFactoryDeps,
): PipelineLauncher | null {
  const { entry } = resolved;
  const { workerRuntime } = deps;

  switch (entry.pipelineKey) {
    case "tracking": {
      const obs = obsCtxFor(deps, "tracking");
      const runner = createTrackingRunner(
        deps.dataSource,
        obs ? createWorkloadObsConfig(obs) : undefined,
        { intervalMs: workerRuntime.tracking.intervalMs },
      );
      return new RunnerPlatformLauncher("tracking", runner);
    }
    case "parse": {
      if (!deps.phasePlatform?.parseTool) return null;
      const obs = obsCtxFor(deps, "parse");
      return new ParseRunnerLauncher(
        new ParseRunnerRegistry({ ...deps.phasePlatform, obs }),
      );
    }
    case "geo-enrich": {
      if (!deps.phasePlatform?.placeEnrichmentRunner) return null;
      const obs = obsCtxFor(deps, "geo-enrich");
      return new GeoRunnerLauncher(
        new GeoRunnerRegistry({
          ...deps.phasePlatform,
          placeEnrichmentRunner: deps.phasePlatform.placeEnrichmentRunner,
          obs,
        }),
      );
    }
    default:
      return null;
  }
}
