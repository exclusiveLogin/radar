/**
 * ---
 * layer: worker/application
 * domain: parse/runner
 * purpose: Реестр parse-workload'ов на runner platform — по одному на каждую enabled
 *          scheduled ingestParse-фазу. Периодически сверяет список фаз (админка может
 *          включать/выключать фазы в рантайме) и создаёт/останавливает workload под них.
 *          Аналог `IngestParseDaemonService.refreshSchedules`, но каждая фаза — свой jobKernel
 *          вместо bespoke `Map<phaseId, setInterval>`.
 * ---
 */
import type {
  IPhaseCoverageRepository,
  IPhaseDefinitionRepository,
  IPhaseRunRepository,
  IPlaceEnrichmentJobRepository,
} from "@radar/shared";
import type { PlaceEnrichmentRunner } from "../../geo-parse/placeEnrichmentRunner.js";
import type { PhaseRunner } from "../../phases/phaseRunner.js";
import { createUnifiedPhaseWorkload } from "../../runner-platform/unifiedPhaseWorkload.js";
import type { WorkloadObsContext } from "../../runtime/observability/workloadObsHooks.js";
import { createWorkloadObsConfig } from "../../runtime/observability/workloadObsHooks.js";
import type { Workload } from "../../runtime/workload/createWorkload.js";

const DEFAULT_REFRESH_MS = 15_000;

export type GeoRunnerRegistryDeps = {
  phases: IPhaseDefinitionRepository;
  phaseRuns: IPhaseRunRepository;
  coverage: IPhaseCoverageRepository;
  placeJobs: IPlaceEnrichmentJobRepository;
  runner: PhaseRunner;
  placeEnrichmentRunner: PlaceEnrichmentRunner;
  obs?: WorkloadObsContext;
};

export class GeoRunnerRegistry {
  private workloads = new Map<string, Workload>();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = true;

  constructor(private readonly deps: GeoRunnerRegistryDeps) {}

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

  /** Wave 6 (chaining): будит все активные phase-workload'ы вне их интервала (событие вместо ожидания). */
  enqueueAll(): void {
    for (const workload of this.workloads.values()) workload.enqueue();
  }

  private async refresh(): Promise<void> {
    if (this.stopped) return;
    const scheduled = await this.deps.phases.listEnabled("scheduled", "geoParse");
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
