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
import type { IPhaseCoverageRepository, IPhaseDefinitionRepository, IPhaseRunRepository } from "@radar/shared";
import type { PhaseRunner } from "../../phases/phaseRunner.js";
import { createParsePhaseWorkload } from "./parsePhaseWorkload.js";
import type { Workload } from "../../runtime/workload/createWorkload.js";

const DEFAULT_REFRESH_MS = 15_000;

function isParseRunnerPlatformEnabled(): boolean {
  return process.env.PARSE_RUNNER_PLATFORM_ENABLED === "true";
}

export type ParseRunnerRegistryDeps = {
  phases: IPhaseDefinitionRepository;
  phaseRuns: IPhaseRunRepository;
  coverage: IPhaseCoverageRepository;
  runner: PhaseRunner;
};

export class ParseRunnerRegistry {
  private workloads = new Map<string, Workload>();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = true;

  constructor(private readonly deps: ParseRunnerRegistryDeps) {}

  static enabled(): boolean {
    return isParseRunnerPlatformEnabled();
  }

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

  private async refresh(): Promise<void> {
    if (this.stopped) return;
    const scheduled = await this.deps.phases.listEnabled("scheduled", "ingestParse");
    const ids = new Set(scheduled.map((p) => p.id));

    for (const [id, workload] of this.workloads) {
      if (!ids.has(id)) {
        workload.stop();
        this.workloads.delete(id);
      }
    }

    for (const phase of scheduled) {
      if (this.workloads.has(phase.id)) continue;
      const workload = createParsePhaseWorkload(this.deps, phase);
      workload.start();
      this.workloads.set(phase.id, workload);
    }
  }
}
