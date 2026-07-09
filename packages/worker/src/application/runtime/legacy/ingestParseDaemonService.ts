import type {
  IPhaseCoverageRepository,
  IPhaseDefinitionRepository,
  IPhaseRunRepository,
  PhaseDefinitionRecord,
} from "@radar/shared";
import { PhaseRunner } from "../../phases/phaseRunner.js";
import { sortPhasesByOrder } from "../../phases/phaseOrder.js";
import type { ObsTickReporter } from "./obsTickReporter.js";
import { DEFAULT_WORKER_RUNTIME_MANIFEST } from "@radar/shared/manifest/domains/workerRuntime.loader.js";

export type IngestParseDaemonConfig = {
  pollMs?: number;
  runStaleMs?: number;
  enabled?: boolean;
};

/**
 * Scheduled ingestParse-фазы: drain queue_parse_coverage → PhaseRunner.
 * Параллельно с GeoParseDaemon (job_geo_place_enrich).
 */
export class IngestParseDaemonService {
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private scheduleRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private running = new Set<string>();
  private stopped = false;

  constructor(
    private readonly phases: IPhaseDefinitionRepository,
    private readonly phaseRuns: IPhaseRunRepository,
    private readonly coverage: IPhaseCoverageRepository,
    private readonly runner: PhaseRunner,
    private readonly onObsTick?: ObsTickReporter,
    private readonly config: IngestParseDaemonConfig = {},
  ) {}

  private pollMs(): number {
    return this.config.pollMs ?? DEFAULT_WORKER_RUNTIME_MANIFEST.parse.daemon.pollMs;
  }

  private runStaleMs(): number {
    return this.config.runStaleMs ?? DEFAULT_WORKER_RUNTIME_MANIFEST.parse.runStaleMs;
  }

  start(): void {
    this.stopped = false;
    void this.refreshSchedules();
    this.scheduleRefreshTimer = setInterval(
      () => void this.refreshSchedules(),
      this.pollMs(),
    );
  }

  stop(): void {
    this.stopped = true;
    if (this.scheduleRefreshTimer) {
      clearInterval(this.scheduleRefreshTimer);
      this.scheduleRefreshTimer = null;
    }
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
    this.running.clear();
  }

  private async refreshSchedules(): Promise<void> {
    if (this.stopped) return;
    const scheduled = sortPhasesByOrder(
      await this.phases.listEnabled("scheduled", "ingestParse"),
    );
    const ids = new Set(scheduled.map((p) => p.id));

    for (const [id, timer] of this.timers) {
      if (!ids.has(id)) {
        clearInterval(timer);
        this.timers.delete(id);
      }
    }

    for (const phase of scheduled) {
      if (this.timers.has(phase.id)) continue;
      const intervalMs = Math.max(phase.policy.intervalMs, phase.policy.minIntervalMs, 1000);
      const timer = setInterval(() => void this.tickPhase(phase), intervalMs);
      this.timers.set(phase.id, timer);
    }
  }

  private async tickPhase(phase: PhaseDefinitionRecord): Promise<void> {
    if (this.stopped || this.running.has(phase.id)) return;
    this.running.add(phase.id);
    try {
      const stale = await this.phaseRuns.failStaleActiveRuns(phase.id, this.runStaleMs());
      if (stale > 0) {
        console.warn(`IngestParseDaemon[${phase.id}]: failed ${stale} stale run(s)`);
      }

      const active = await this.phaseRuns.findActiveForPhase(phase.id);
      if (active) return;

      const counts = await this.coverage.countByStatus(phase.id);
      const pendingWork = counts.pending + counts.processing;
      if (pendingWork === 0) return;

      const run = await this.phaseRuns.create({
        phaseId: phase.id,
        trigger: "scheduled",
        status: "pending",
      });

      const stats = await this.runner.runDrain({
        phase,
        runId: run.id,
        batchSize: phase.policy.batchSize,
        trigger: "scheduled",
      });
      void this.onObsTick?.({ phaseId: phase.id, ...stats });
    } catch (err) {
      console.error(`IngestParseDaemon[${phase.id}]:`, err);
    } finally {
      this.running.delete(phase.id);
    }
  }
}
