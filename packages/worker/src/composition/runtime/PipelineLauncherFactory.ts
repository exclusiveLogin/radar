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
import type { PhaseRunner } from "../../application/phases/phaseRunner.js";
import {
  createWorkloadObsConfig,
  type WorkloadObsContext,
} from "../../application/runtime/observability/workloadObsHooks.js";
import { ParseRunnerRegistry } from "../../application/parse/runner/parseRunnerRegistry.js";
import { GeoRunnerRegistry } from "../../application/geo-parse/runner/geoRunnerRegistry.js";
import { createTrackingRunner } from "../../application/tracking/runner/trackingRunner.js";
import type { Workload } from "../../application/runtime/workload/createWorkload.js";
import type { WorkerDbRepositories } from "../../infrastructure/persistence/workerDbRepos.types.js";
import type { PipelineLauncher } from "../../application/runtime/pipelineLauncher.js";
import type { ResolvedRuntimePipeline } from "./RuntimeResolver.js";

export type PipelineLauncherFactoryDeps = {
  dataSource: DataSource;
  workerRepos: WorkerDbRepositories;
  phaseRunner?: PhaseRunner;
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

/** Создаёт runner-platform launcher; null если phaseRunner недоступен. */
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
      if (!deps.phaseRunner) return null;
      const parseDeps = {
        phases: deps.workerRepos.phaseDefinitions,
        phaseRuns: deps.workerRepos.phaseRuns,
        coverage: deps.workerRepos.phaseCoverage,
        placeJobs: deps.workerRepos.placeEnrichmentJobs,
        runner: deps.phaseRunner,
        placeEnrichmentRunner: deps.phaseRunner.placeEnrichmentRunner,
      };
      const obs = obsCtxFor(deps, "parse");
      return new ParseRunnerLauncher(
        new ParseRunnerRegistry({ ...parseDeps, obs }),
      );
    }
    case "geo-enrich": {
      if (!deps.phaseRunner?.placeEnrichmentRunner) return null;
      const geoDeps = {
        phases: deps.workerRepos.phaseDefinitions,
        phaseRuns: deps.workerRepos.phaseRuns,
        coverage: deps.workerRepos.phaseCoverage,
        placeJobs: deps.workerRepos.placeEnrichmentJobs,
        runner: deps.phaseRunner,
        placeEnrichmentRunner: deps.phaseRunner.placeEnrichmentRunner,
      };
      const obs = obsCtxFor(deps, "geo-enrich");
      return new GeoRunnerLauncher(new GeoRunnerRegistry({ ...geoDeps, obs }));
    }
    default:
      return null;
  }
}
