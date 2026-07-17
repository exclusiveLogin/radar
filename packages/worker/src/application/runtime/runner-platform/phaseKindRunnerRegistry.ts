import type {
  IPhaseCoverageRepository,
  IPhaseDefinitionRepository,
  IPhaseRunRepository,
  IPlaceEnrichmentJobRepository,
  PhaseScope,
} from "@radar/shared";
import type { PlaceEnrichmentRunner } from "../../geo-parse/placeEnrichmentRunner.js";
import type { PhaseRunner } from "../../phases/phaseRunner.js";
import { createUnifiedPhaseWorkload } from "./unifiedPhaseWorkload.js";
import type { WorkloadObsContext } from "../observability/workloadObsHooks.js";
import { createWorkloadObsConfig } from "../observability/workloadObsHooks.js";
import type { Workload } from "../workload/createWorkload.js";

const DEFAULT_REFRESH_MS = 15_000;

export type PhaseKindRunnerRegistryDeps = {
  phases: IPhaseDefinitionRepository;
  phaseRuns: IPhaseRunRepository;
  coverage: IPhaseCoverageRepository;
  placeJobs: IPlaceEnrichmentJobRepository;
  runner: PhaseRunner;
  placeEnrichmentRunner?: PlaceEnrichmentRunner;
  obs?: WorkloadObsContext;
};

/** Общий реестр scheduled phase-workload по PhaseKind (parse/geo). */
export class PhaseKindRunnerRegistry {
  private workloads = new Map<string, Workload>();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = true;

  constructor(
    private readonly deps: PhaseKindRunnerRegistryDeps,
    private readonly phaseScope: PhaseScope,
  ) {}

  start(): void {
    this.stopped = false;
    void this.refresh();
    this.refreshTimer = setInterval(() => void this.refresh(), DEFAULT_REFRESH_MS);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    for (const workload of this.workloads.values()) workload.stop();
    this.workloads.clear();
  }

  enqueueAll(): void {
    for (const workload of this.workloads.values()) workload.enqueue();
  }

  async refresh(): Promise<void> {
    if (this.stopped) return;
    const scheduled = await this.deps.phases.listEnabled(undefined, this.phaseScope);
    const ids = new Set(scheduled.map((p) => p.id));

    for (const [id, workload] of this.workloads) {
      if (!ids.has(id)) {
        workload.stop();
        this.workloads.delete(id);
      }
    }

    for (const phase of scheduled) {
      if (this.workloads.has(phase.id)) continue;
      const phaseObs = this.deps.obs
        ? createWorkloadObsConfig({ ...this.deps.obs, workloadIdSuffix: phase.id })
        : undefined;
      const workload = createUnifiedPhaseWorkload(this.deps, phase, phaseObs);
      workload.start();
      this.workloads.set(phase.id, workload);
    }
  }
}