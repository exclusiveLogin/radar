import type {
  IPhaseCoverageRepository,
  IPhaseDefinitionRepository,
  IPhaseRunRepository,
  PhaseDefinitionRecord,
} from "@radar/shared";
import { PhaseRunner } from "./phaseRunner.js";
import { sortPhasesByOrder } from "./phaseOrder.js";

const DEFAULT_POLL_MS = 15_000;
const DEFAULT_STALE_RUN_MS = 2 * 60 * 60 * 1000;

/** Включён ли демон ingestParse (legacy: RADAR_PHASE_DAEMON_ENABLED). */
function isIngestParseDaemonEnabled(): boolean {
  const raw =
    process.env.RADAR_INGEST_PARSE_DAEMON_ENABLED?.trim().toLowerCase() ??
    process.env.RADAR_PHASE_DAEMON_ENABLED?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return process.env.RADAR_STORAGE_MODE?.trim().toLowerCase() === "db";
}

function resolvePollMs(): number {
  const parsed = Number(
    process.env.RADAR_INGEST_PARSE_DAEMON_POLL_MS ??
      process.env.RADAR_PHASE_DAEMON_POLL_MS,
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_POLL_MS;
}

function resolveStaleRunMs(): number {
  const parsed = Number(process.env.RADAR_PHASE_RUN_STALE_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_STALE_RUN_MS;
}

/**
 * Scheduled ingestParse-фазы: drain phase_coverage → PhaseRunner.
 * Параллельно с GeoParseDaemon (place_enrichment_jobs).
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
  ) {}

  static enabled(): boolean {
    return isIngestParseDaemonEnabled();
  }

  start(): void {
    this.stopped = false;
    void this.refreshSchedules();
    this.scheduleRefreshTimer = setInterval(
      () => void this.refreshSchedules(),
      resolvePollMs(),
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
      const stale = await this.phaseRuns.failStaleActiveRuns(phase.id, resolveStaleRunMs());
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

      await this.runner.runDrain({
        phase,
        runId: run.id,
        batchSize: phase.policy.batchSize,
        trigger: "scheduled",
      });
    } catch (err) {
      console.error(`IngestParseDaemon[${phase.id}]:`, err);
    } finally {
      this.running.delete(phase.id);
    }
  }
}
