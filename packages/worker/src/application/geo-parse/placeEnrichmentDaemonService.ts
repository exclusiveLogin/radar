import type {
  IPhaseDefinitionRepository,
  IPhaseRunRepository,
  IPlaceEnrichmentJobRepository,
  PhaseDefinitionRecord,
} from "@radar/shared";
import { resolveGeoEnrichmentProvider } from "@radar/shared";
import { PhaseRunner } from "../phases/phaseRunner.js";
import { sortPhasesByOrder } from "../phases/phaseOrder.js";

const DEFAULT_POLL_MS = 15_000;
const DEFAULT_STALE_RUN_MS = 2 * 60 * 60 * 1000;
/** Нет heartbeat у phase_run — считаем run сиротой (worker умер / рестарт). */
const DEFAULT_ORPHAN_RUN_MS = 60_000;

function resolvePollMs(): number {
  const parsed = Number(process.env.RADAR_GEO_PARSE_DAEMON_POLL_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_POLL_MS;
}

function resolveStaleRunMs(): number {
  const parsed = Number(process.env.RADAR_PHASE_RUN_STALE_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_STALE_RUN_MS;
}

function resolveOrphanRunMs(): number {
  const parsed = Number(process.env.RADAR_GEO_ORPHAN_RUN_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ORPHAN_RUN_MS;
}

/**
 * Scheduled geoParse: drain place_enrichment_jobs через phase_run (как IngestParseDaemon).
 * Без phase_run админка «Запуски» и progress bar не видят scheduled geo.
 */
export class PlaceEnrichmentDaemonService {
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private running = new Set<string>();
  private stopped = false;

  constructor(
    private readonly phases: IPhaseDefinitionRepository,
    private readonly phaseRuns: IPhaseRunRepository,
    private readonly placeJobs: IPlaceEnrichmentJobRepository,
    private readonly runner: PhaseRunner,
  ) {}

  start(): void {
    this.stopped = false;
    void this.bootstrap().then(() => this.refreshSchedules());
    this.refreshTimer = setInterval(() => void this.refreshSchedules(), resolvePollMs());
  }

  /** После рестарта worker: reclaim processing и сразу resume active geo run. */
  private async bootstrap(): Promise<void> {
    const scheduled = sortPhasesByOrder(await this.phases.listEnabled("scheduled", "geoParse"));
    for (const phase of scheduled) {
      const provider = resolveGeoEnrichmentProvider(phase);
      if (!provider) continue;

      const active = await this.phaseRuns.findActiveForPhase(phase.id);
      if (!active) continue;

      const reset = await this.placeJobs.resetProcessingForProvider(provider);
      console.warn(
        `GeoParseDaemon[${phase.id}]: startup resume run=${active.id.slice(0, 8)} processing→pending=${reset}`,
      );
      void this.tickPhase(phase);
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
    this.running.clear();
  }

  private async refreshSchedules(): Promise<void> {
    if (this.stopped) return;
    const scheduled = sortPhasesByOrder(await this.phases.listEnabled("scheduled", "geoParse"));
    const ids = new Set(scheduled.map((phase) => phase.id));

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
      // Первый drain сразу после старта worker, не ждать intervalMs (120s).
      void this.tickPhase(phase);
    }
  }

  private async tickPhase(phase: PhaseDefinitionRecord): Promise<void> {
    if (this.stopped || this.running.has(phase.id)) return;
    this.running.add(phase.id);
    try {
      const stale = await this.phaseRuns.failStaleActiveRuns(phase.id, resolveStaleRunMs());
      if (stale > 0) {
        console.warn(`GeoParseDaemon[${phase.id}]: failed ${stale} stale run(s)`);
      }

      const provider = resolveGeoEnrichmentProvider(phase);
      if (!provider) return;

      let active = await this.phaseRuns.findActiveForPhase(phase.id);
      if (active) {
        const orphans = await this.phaseRuns.failStaleActiveRuns(phase.id, resolveOrphanRunMs());
        if (orphans > 0) {
          const reset = await this.placeJobs.resetProcessingForProvider(provider);
          console.warn(
            `GeoParseDaemon[${phase.id}]: stale run failed, processing→pending=${reset}`,
          );
          active = await this.phaseRuns.findActiveForPhase(phase.id);
        }
      }

      const counts = await this.placeJobs.countByStatus(provider);
      const pendingWork = counts.pending + counts.processing;
      if (pendingWork === 0) return;

      const runId =
        active && (active.status === "running" || active.status === "pending")
          ? active.id
          : (
              await this.phaseRuns.create({
                phaseId: phase.id,
                trigger: "scheduled",
                status: "pending",
              })
            ).id;

      if (active && runId === active.id) {
        console.log(
          `GeoParseDaemon[${phase.id}]: resume drain run=${runId.slice(0, 8)} pending≈${pendingWork}`,
        );
      } else {
        console.log(
          `GeoParseDaemon[${phase.id}]: new drain run=${runId.slice(0, 8)} pending≈${pendingWork}`,
        );
      }

      await this.runner.runDrain({
        phase,
        runId,
        batchSize: phase.policy.batchSize,
        trigger: "scheduled",
      });
    } catch (error) {
      console.error(`GeoParseDaemon[${phase.id}]`, error);
    } finally {
      this.running.delete(phase.id);
    }
  }
}
