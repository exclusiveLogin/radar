import type {
  IPhaseDefinitionRepository,
  IPhaseRunRepository,
  IPlaceEnrichmentJobRepository,
  PhaseDefinitionRecord,
} from "@radar/shared";
import { resolveGeoEnrichmentProvider } from "@radar/shared";
import { PhaseRunner } from "../../phases/phaseRunner.js";
import { sortPhasesByOrder } from "../../phases/phaseOrder.js";
import type { ObsTickReporter } from "./obsTickReporter.js";

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

function resolvePhaseTickMs(phase: PhaseDefinitionRecord): number {
  return Math.max(phase.policy.intervalMs, phase.policy.minIntervalMs, 1000);
}

/**
 * Scheduled geoParse: drain job_geo_place_enrich через phase_run (как IngestParseDaemon).
 * DaData и Nominatim — строго последовательно (один drain за раз, порядок фаз по order).
 */
export class PlaceEnrichmentDaemonService {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private drainTimer: ReturnType<typeof setInterval> | null = null;
  private drainTickMs: number | null = null;
  /** Глобальный mutex: не запускать drain двух geo-фаз параллельно. */
  private geoDrainBusy = false;
  private lastPhaseDrainAt = new Map<string, number>();
  private stopped = false;

  constructor(
    private readonly phases: IPhaseDefinitionRepository,
    private readonly phaseRuns: IPhaseRunRepository,
    private readonly placeJobs: IPlaceEnrichmentJobRepository,
    private readonly runner: PhaseRunner,
    private readonly onObsTick?: ObsTickReporter,
  ) {}

  start(): void {
    this.stopped = false;
    void this.bootstrap().then(() => this.refreshSchedules());
    this.refreshTimer = setInterval(() => void this.refreshSchedules(), resolvePollMs());
  }

  /** После рестарта worker: reclaim processing и resume active geo run. */
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
    }
    await this.tickAllPhases();
  }

  stop(): void {
    this.stopped = true;
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.drainTimer) {
      clearInterval(this.drainTimer);
      this.drainTimer = null;
    }
    this.drainTickMs = null;
    this.geoDrainBusy = false;
    this.lastPhaseDrainAt.clear();
  }

  private async refreshSchedules(): Promise<void> {
    if (this.stopped) return;
    const scheduled = sortPhasesByOrder(await this.phases.listEnabled("scheduled", "geoParse"));
    const tickMs =
      scheduled.length > 0
        ? Math.min(...scheduled.map((phase) => resolvePhaseTickMs(phase)))
        : null;

    if (tickMs === this.drainTickMs) return;

    if (this.drainTimer) {
      clearInterval(this.drainTimer);
      this.drainTimer = null;
    }
    this.drainTickMs = tickMs;

    if (!tickMs) return;

    this.drainTimer = setInterval(() => void this.tickAllPhases(), tickMs);
    void this.tickAllPhases();
  }

  /** Один проход: фазы по order, без параллельного drain. Nominatim — только после пустой очереди DaData. */
  private async tickAllPhases(): Promise<void> {
    if (this.stopped || this.geoDrainBusy) return;
    this.geoDrainBusy = true;
    try {
      const scheduled = sortPhasesByOrder(await this.phases.listEnabled("scheduled", "geoParse"));
      for (const phase of scheduled) {
        if (this.stopped) break;

        const provider = resolveGeoEnrichmentProvider(phase);
        if (provider === "nominatim" && (await this.isDadataQueueBusy())) {
          continue;
        }

        const intervalMs = resolvePhaseTickMs(phase);
        const lastDrain = this.lastPhaseDrainAt.get(phase.id) ?? 0;
        if (Date.now() - lastDrain < intervalMs) continue;

        await this.tickPhase(phase);
        this.lastPhaseDrainAt.set(phase.id, Date.now());
      }
    } finally {
      this.geoDrainBusy = false;
    }
  }

  private async isDadataQueueBusy(): Promise<boolean> {
    const counts = await this.placeJobs.countByStatus("dadata");
    return counts.pending + counts.processing > 0;
  }

  private async tickPhase(phase: PhaseDefinitionRecord): Promise<void> {
    if (this.stopped) return;
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

      const stats = await this.runner.runDrain({
        phase,
        runId,
        batchSize: phase.policy.batchSize,
        trigger: "scheduled",
      });
      void this.onObsTick?.({ phaseId: phase.id, provider, pendingWork, ...stats });
    } catch (error) {
      console.error(`GeoParseDaemon[${phase.id}]`, error);
    }
  }
}
