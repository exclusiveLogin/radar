import type { PhaseScope } from "@radar/shared";
import { createUnifiedPhaseWorkload } from "./unifiedPhaseWorkload.js";
import type { PhasePlatformDeps } from "./phasePlatformDeps.js";
import { createWorkloadObsConfig } from "../observability/workloadObsHooks.js";
import type { Workload } from "../workload/createWorkload.js";
import { mergeJobKernelObs } from "./mergeJobKernelObs.js";

const DEFAULT_REFRESH_MS = 15_000;

export type PhaseKindRunnerRegistryDeps = PhasePlatformDeps;

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
      const recorderObs = this.deps.obs
        ? createWorkloadObsConfig({ ...this.deps.obs, workloadIdSuffix: phase.id })
        : undefined;
      const phaseObs = mergeJobKernelObs(recorderObs, this.deps.stabilityObs);
      const workload = createUnifiedPhaseWorkload(this.deps, phase, phaseObs);
      workload.start();
      this.workloads.set(phase.id, workload);
    }
  }
}
