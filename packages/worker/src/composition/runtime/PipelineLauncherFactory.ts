/**
 * ---
 * layer: worker/composition
 * domain: deployment/runtime
 * purpose: Фабрика PipelineLauncher — legacy adapter | runner-platform workload по schedulingImpl.
 * ---
 */
import type { DataSource } from "typeorm";
import type { IObservabilityRecorder, PipelineKey } from "@radar/shared";
import type { PhaseRunner } from "../../application/phases/phaseRunner.js";
import { IngestParseDaemonService } from "../../application/runtime/legacy/ingestParseDaemonService.js";
import { PlaceEnrichmentDaemonService } from "../../application/runtime/legacy/placeEnrichmentDaemonService.js";
import { TrackingRebuildDaemon } from "../../application/runtime/legacy/trackingRebuildDaemon.js";
import {
  createLegacyGeoEnrichLauncher,
  createLegacyIngestParseLauncher,
  createLegacyTrackingLauncher,
  LegacyWorkloadAdapter,
} from "../../application/runtime/legacy/LegacyWorkloadAdapter.js";
import {
  createWorkloadObsConfig,
  type WorkloadObsContext,
} from "../../application/runtime/observability/workloadObsHooks.js";
import { createGeoEnrichRunner } from "../../application/geo-parse/runner/geoEnrichRunner.js";
import { ParseRunnerRegistry } from "../../application/parse/runner/parseRunnerRegistry.js";
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
};

/** Runner-platform Workload → PipelineLauncher (+ optional enqueue). */
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

/** ParseRunnerRegistry уже имеет start/stop/enqueueAll — оборачиваем как launcher. */
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

function obsCtxFor(
  deps: PipelineLauncherFactoryDeps,
  pipelineKey: PipelineKey,
  runtime: "legacy" | "runner-platform",
): WorkloadObsContext | undefined {
  if (!deps.obsBinding) return undefined;
  return {
    recorder: deps.obsBinding.recorder,
    hostId: deps.obsBinding.hostId,
    pipelineKey,
    runtime,
  };
}

/** Создаёт launcher для одного resolved pipeline; null если schedulingImpl не поддержан. */
export function createPipelineLauncher(
  resolved: ResolvedRuntimePipeline,
  deps: PipelineLauncherFactoryDeps,
): PipelineLauncher | null {
  const { entry, runtime, schedulingImpl } = resolved;
  const obsBinding = deps.obsBinding;

  switch (entry.pipelineKey) {
    case "tracking": {
      if (schedulingImpl === "runner-platform") {
        const obs = obsCtxFor(deps, "tracking", "runner-platform");
        const runner = createTrackingRunner(
          deps.dataSource,
          obs ? createWorkloadObsConfig(obs) : undefined,
        );
        return new RunnerPlatformLauncher("tracking", runner);
      }
      if (obsBinding) {
        return createLegacyTrackingLauncher(deps.dataSource, obsBinding);
      }
      return wrapLegacyDaemon("tracking", new TrackingRebuildDaemon(deps.dataSource));
    }
    case "parse": {
      if (!deps.phaseRunner) return null;
      const parseDeps = {
        phases: deps.workerRepos.phaseDefinitions,
        phaseRuns: deps.workerRepos.phaseRuns,
        coverage: deps.workerRepos.phaseCoverage,
        runner: deps.phaseRunner,
      };
      if (schedulingImpl === "runner-platform") {
        const obs = obsCtxFor(deps, "parse", "runner-platform");
        return new ParseRunnerLauncher(
          new ParseRunnerRegistry({ ...parseDeps, obs }),
        );
      }
      if (obsBinding) {
        return createLegacyIngestParseLauncher(parseDeps, obsBinding);
      }
      return wrapLegacyDaemon(
        "parse",
        new IngestParseDaemonService(
          parseDeps.phases,
          parseDeps.phaseRuns,
          parseDeps.coverage,
          parseDeps.runner,
        ),
      );
    }
    case "geo-enrich": {
      if (!deps.phaseRunner) return null;
      const geoDeps = {
        phases: deps.workerRepos.phaseDefinitions,
        phaseRuns: deps.workerRepos.phaseRuns,
        placeJobs: deps.workerRepos.placeEnrichmentJobs,
        runner: deps.phaseRunner,
      };
      if (schedulingImpl === "runner-platform") {
        const obs = obsCtxFor(deps, "geo-enrich", "runner-platform");
        const runner = createGeoEnrichRunner(geoDeps, obs);
        return new RunnerPlatformLauncher("geo-enrich", runner);
      }
      if (obsBinding) {
        return createLegacyGeoEnrichLauncher(geoDeps, obsBinding);
      }
      return wrapLegacyDaemon(
        "geo-enrich",
        new PlaceEnrichmentDaemonService(
          geoDeps.phases,
          geoDeps.phaseRuns,
          geoDeps.placeJobs,
          geoDeps.runner,
        ),
      );
    }
    default:
      return null;
  }
}

/** Legacy daemon без obs — минимальный PipelineLauncher-адаптер. */
function wrapLegacyDaemon(
  pipelineKey: PipelineKey,
  daemon: { start(): void; stop(): void | Promise<void> },
): PipelineLauncher {
  return {
    pipelineKey,
    runtime: "legacy",
    start: () => daemon.start(),
    stop: () => daemon.stop(),
  };
}

export type { LegacyWorkloadAdapter };
