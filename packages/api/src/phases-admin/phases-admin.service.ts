import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Inject } from "@nestjs/common";
import { MapRealtimeBroadcastService } from "../map/map-realtime-broadcast.service";
import {
  drainTopicForPhaseScope,
  manualRunScopeSchema,
  phaseReplayRequestSchema,
  RADAR_TOPICS,
  resolveGeoEnrichmentProvider,
  type IEventTransport,
  type PhaseDefinitionRecord,
  type PhaseRun,
  type PhaseRunsOverview,
} from "@radar/shared";
import { DataSource } from "typeorm";
import { TypeOrmPhaseCoverageRepository } from "@radar/persistence";
import { TypeOrmPhaseDefinitionRepository } from "@radar/persistence";
import { TypeOrmPhaseRunRepository } from "@radar/persistence";
import { TypeOrmPlaceEnrichmentJobRepository } from "@radar/persistence";
import {
  PHASES_ADMIN_DEPENDENCIES,
  type PhasesAdminDependencies,
} from "./phases-admin.providers";

const STOP_ALL_ACTIVE_RUNS_REASON = "admin:stop-all-active-runs";

function emptyJobCounts(): PhaseRunsOverview["geo"]["byPhase"][0]["jobs"] {
  return { pending: 0, processing: 0, done: 0, failed: 0 };
}

/** Coordinates parse-engine coverage and geo-enrichment phases. */
@Injectable()
export class PhasesAdminService implements OnModuleInit, OnModuleDestroy {
  private readonly dataSource: DataSource;
  private readonly phases: TypeOrmPhaseDefinitionRepository;
  private readonly coverage: TypeOrmPhaseCoverageRepository;
  private readonly runs: TypeOrmPhaseRunRepository;
  private readonly placeJobs: TypeOrmPlaceEnrichmentJobRepository;
  private transport!: IEventTransport;

  constructor(
    @Inject(PHASES_ADMIN_DEPENDENCIES)
    deps: PhasesAdminDependencies,
    private readonly mapRealtime: MapRealtimeBroadcastService,
  ) {
    this.dataSource = deps.dataSource;
    this.phases = deps.phases;
    this.coverage = deps.coverage;
    this.runs = deps.runs;
    this.placeJobs = deps.placeJobs;
    this.transport = deps.transport;
  }

  /** Starts RMQ transport for admin control signals. */
  async onModuleInit(): Promise<void> {
    await this.transport.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.transport?.stop();
  }

  listPhases(): Promise<PhaseDefinitionRecord[]> {
    return this.phases.listAll();
  }

  async getPhase(id: string): Promise<PhaseDefinitionRecord> {
    const phase = await this.phases.findById(id);
    if (!phase) throw new NotFoundException(`phase ${id} not found`);
    return phase;
  }

  async patchPhase(id: string, body: unknown): Promise<PhaseDefinitionRecord> {
    const record = await this.getPhase(id);
    const patch = body as {
      enabled?: boolean;
      policy?: Record<string, unknown>;
      enrichers?: string[];
    };
    if (patch.enabled !== undefined) {
      await this.phases.setEnabled(id, patch.enabled);
      await this.publishRunnerControl(id, patch.enabled);
      const updated = await this.getPhase(id);
      if (patch.enabled) {
        await this.enqueueCatchUpForPhase(updated);
      } else {
        await this.clearPhaseQueueForPhase(updated);
      }
    }
    if (patch.policy) {
      await this.phases.updatePolicy(id, patch.policy);
    }
    if (patch.enrichers?.length) {
      await this.phases.upsert({
        ...record,
        enrichers: patch.enrichers as PhaseDefinitionRecord["enrichers"],
      });
    }
    return this.getPhase(id);
  }

  /** Снять pending/processing очереди фазы (ingest coverage или geo jobs). */
  private async clearPhaseQueueForPhase(phase: PhaseDefinitionRecord): Promise<number> {
    if (phase.scope === "geoParse") {
      const provider = resolveGeoEnrichmentProvider(phase);
      if (!provider) return 0;
      return this.placeJobs.clearQueuedWork(provider);
    }
    return this.coverage.clearQueuedWork([phase.id]);
  }

  private async cancelActiveRunsForPhase(phaseId: string, reason: string): Promise<number> {
    const statuses = ["running", "paused", "pending"] as const;
    let canceled = 0;
    for (const status of statuses) {
      const runs = await this.runs.list({ phaseId, status, limit: 100 });
      for (const run of runs) {
        await this.runs.requestControl(run.id, "cancel");
        await this.runs.updateStatus(run.id, "canceled", { error: reason });
        canceled += 1;
      }
    }
    return canceled;
  }

  /**
   * Очистить очередь одной фазы + отменить её runs.
   * GeoParseDaemon не создаёт runs — без этого «Cancel» в UI бесполезен.
   */
  async clearPhaseQueue(phaseId: string): Promise<{
    ok: true;
    cleared: number;
    runsCanceled: number;
  }> {
    const phase = await this.getPhase(phaseId);
    const runsCanceled = await this.cancelActiveRunsForPhase(
      phaseId,
      `admin:clear-queue:${phaseId}`,
    );
    const cleared = await this.clearPhaseQueueForPhase(phase);
    return { ok: true, cleared, runsCanceled };
  }

  /** Resets failed geo jobs to pending for the configured provider. */
  async resetFailedJobs(phaseId: string): Promise<{ ok: true; reset: number }> {
    const phase = await this.getPhase(phaseId);
    if (phase.scope !== "geoParse") {
      throw new BadRequestException("reset-failed only for geoParse phases");
    }
    const provider = resolveGeoEnrichmentProvider(phase);
    if (!provider) {
      throw new BadRequestException(`phase ${phaseId} has no geo provider`);
    }
    const reset = await this.placeJobs.resetFailedForProvider(provider);
    return { ok: true, reset };
  }

  /** Enqueues catch-up work and wakes the appropriate worker. */
  private async enqueueCatchUpForPhase(
    phase: PhaseDefinitionRecord,
  ): Promise<{ enqueued: number }> {
    let enqueued = 0;
    if (phase.scope === "ingestParse") {
      const result = await this.coverage.enqueueCatchUp(phase.id);
      enqueued = result.enqueued;
    } else if (phase.scope === "geoParse") {
      const provider = resolveGeoEnrichmentProvider(phase);
      if (!provider) return { enqueued: 0 };
    }
    await this.publishDrainForPhase(phase, "full", { catchUp: true });
    return { enqueued };
  }

  /** Publishes phase enablement changes to the runner. */
  private publishRunnerControl(phaseKey: string, enabled: boolean): Promise<void> {
    return this.transport.publishSignal(RADAR_TOPICS.RUNNER_CONTROL, { phaseKey, enabled });
  }

  /** Publishes a targeted or full drain signal. */
  private publishDrainForPhase(
    phase: PhaseDefinitionRecord,
    mode: "full" | "targeted" = "full",
    extra: { catchUp?: boolean; materializationIds?: string[]; placeIds?: string[] } = {},
  ): Promise<void> {
    return this.transport.publishSignal(drainTopicForPhaseScope(phase.scope), {
      phaseKey: phase.id,
      mode,
      ...extra,
    });
  }

  async runsOverview(): Promise<PhaseRunsOverview> {
    const allPhases = await this.phases.listAll();
    const active = await this.runs.list({ status: "running", limit: 50 });

    const ingestPhases = allPhases.filter((p) => p.scope === "ingestParse");
    const geoPhases = allPhases.filter((p) => p.scope === "geoParse");

    const ingestByPhase = await Promise.all(
      ingestPhases.map(async (phase) => {
        const raw = await this.coverage.countByStatus(phase.id);
        return {
          phaseId: phase.id,
          trigger: phase.trigger ?? phase.triggerMode,
          enabled: phase.enabled,
          activeRun: active.find((r) => r.phaseId === phase.id) ?? null,
          coverage: {
            pending: raw.pending ?? 0,
            processing: raw.processing ?? 0,
            done: raw.done ?? 0,
            failed: raw.failed ?? 0,
          },
        };
      }),
    );

    const geoByPhase = await Promise.all(
      geoPhases.map(async (phase) => {
        const provider = resolveGeoEnrichmentProvider(phase);
        const jobs = provider
          ? await this.placeJobs.countByStatus(provider)
          : emptyJobCounts();
        return {
          phaseId: phase.id,
          trigger: phase.trigger ?? phase.triggerMode,
          enabled: phase.enabled,
          provider,
          activeRun: active.find((r) => r.phaseId === phase.id) ?? null,
          jobs: {
            pending: jobs.pending ?? 0,
            processing: jobs.processing ?? 0,
            done: jobs.done ?? 0,
            failed: jobs.failed ?? 0,
          },
        };
      }),
    );

    const ingestRunning = ingestByPhase.filter(
      (p) => p.activeRun && ["running", "paused", "pending"].includes(p.activeRun.status),
    ).length;

    return {
      runningCount: active.length,
      ingest: { runningCount: ingestRunning, byPhase: ingestByPhase },
      geo: { byPhase: geoByPhase },
    };
  }

  listRuns(query: {
    phaseId?: string;
    status?: string;
    limit?: number;
  }): Promise<PhaseRun[]> {
    return this.runs.list({
      phaseId: query.phaseId,
      status: query.status as PhaseRun["status"] | undefined,
      limit: query.limit ? Number(query.limit) : undefined,
    });
  }

  async getRun(id: string): Promise<PhaseRun & { logTail: PhaseRun["log"] }> {
    const run = await this.runs.findById(id);
    if (!run) throw new NotFoundException(`phase run ${id} not found`);
    return { ...run, logTail: this.runs.logTail(run) };
  }

  async startRun(phaseId: string, body: unknown): Promise<PhaseRun> {
    const phase = await this.getPhase(phaseId);
    const scope = manualRunScopeSchema.safeParse(body ?? {});
    if (!scope.success) throw new BadRequestException(scope.error.issues);

    const run = await this.runs.create({ phaseId, trigger: "manual", status: "pending" });

    if (phase.scope === "geoParse") {
      const provider = resolveGeoEnrichmentProvider(phase);
      if (!provider) {
        throw new BadRequestException(`geo phase ${phaseId} has no external provider`);
      }
    }

    await this.publishDrainForPhase(phase);
    await this.runs.appendLog(run.id, {
      at: new Date().toISOString(),
      level: "info",
      message: `drain signal scope=${phase.scope} phase=${phaseId}`,
    });
    return run;
  }

  async cancelRun(id: string): Promise<{ ok: true }> {
    const run = await this.getRun(id);
    const phase = await this.getPhase(run.phaseId);
    if (run.status === "running" || run.status === "pending" || run.status === "paused") {
      await this.runs.requestControl(id, "cancel");
      if (phase.scope === "ingestParse") {
        await this.coverage.resetProcessingForPhase(run.phaseId);
      } else {
        const provider = resolveGeoEnrichmentProvider(phase);
        if (provider) {
          await this.placeJobs.resetProcessingForProvider(provider);
        }
      }
      await this.runs.updateStatus(id, "canceled", { error: "canceled from admin" });
    }
    return { ok: true };
  }

  async pauseRun(id: string): Promise<{ ok: true }> {
    await this.getRun(id);
    await this.runs.requestControl(id, "pause");
    return { ok: true };
  }

  async resumeRun(id: string): Promise<{ ok: true }> {
    const run = await this.getRun(id);
    if (run.status !== "paused") {
      throw new BadRequestException("run is not paused");
    }
    await this.runs.clearControl(run.id);
    await this.runs.updateStatus(run.id, "pending");
    return { ok: true };
  }

  async stopAllActiveRuns(): Promise<{
    ok: true;
    phaseRunsClosed: number;
    queueCleared: number;
    geoJobsCleared: number;
    processingReleased: number;
  }> {
    const statuses = ["running", "paused", "pending"] as const;
    const toStop = (
      await Promise.all(
        statuses.map((status) => this.runs.list({ status, limit: 200 })),
      )
    ).flat();

    for (const run of toStop) {
      await this.runs.requestControl(run.id, "cancel");
    }

    const ingestPhaseIds = (await this.phases.listAll())
      .filter((p) => p.scope === "ingestParse")
      .map((p) => p.id);
    const queueCleared = await this.coverage.clearQueuedWork(ingestPhaseIds);
    const geoJobsCleared = await this.placeJobs.clearQueuedWork();

    const closedRows = (await this.dataSource.query(
      `UPDATE log_phase_run SET
         status = 'canceled',
         control = 'cancel',
         finished_at = now(),
         error = COALESCE(error, $1),
         updated_at = now()
       WHERE status IN ('running', 'paused', 'pending')
       RETURNING id`,
      [STOP_ALL_ACTIVE_RUNS_REASON],
    )) as Array<{ id: string }>;

    return {
      ok: true,
      phaseRunsClosed: closedRows.length,
      queueCleared,
      geoJobsCleared,
      processingReleased: 0,
    };
  }

  async forceStopRun(id: string): Promise<{ ok: true; reset: number }> {
    const run = await this.getRun(id);
    const phase = await this.getPhase(run.phaseId);
    let reset = 0;
    if (phase.scope === "ingestParse") {
      reset = await this.coverage.resetProcessingForPhase(run.phaseId);
    } else if (phase.scope === "geoParse") {
      const provider = resolveGeoEnrichmentProvider(phase);
      if (provider) {
        reset = await this.placeJobs.resetProcessingForProvider(provider);
      }
    }
    await this.runs.updateStatus(run.id, "canceled");
    return { ok: true, reset };
  }

  /** Publishes a fresh map snapshot after a phase run. */
  async pushMapSnapshot(): Promise<void> {
    await this.mapRealtime.pushSnapshotToClients();
  }

  async replay(body: unknown): Promise<{
    invalidated: number;
    phaseIds: string[];
    placesFlushed: number;
  }> {
    const parsed = phaseReplayRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    const { phaseIds, invalidateCoverage } = parsed.data;
    let invalidated = 0;
    let placesFlushed = 0;
    if (invalidateCoverage) {
      placesFlushed = await this.mapRealtime.flushActivePlacesOnMap();
      const ingestIds: string[] = [];
      for (const phaseId of phaseIds) {
        const phase = await this.phases.findById(phaseId);
        if (!phase) continue;
        if (phase.scope === "geoParse") {
          const provider = resolveGeoEnrichmentProvider(phase);
          if (provider) {
            await this.publishDrainForPhase(phase);
          }
        } else {
          ingestIds.push(phaseId);
        }
      }
      if (ingestIds.length > 0) {
        invalidated = await this.coverage.invalidateForPhases(ingestIds);
        for (const phaseId of ingestIds) {
          const phase = await this.phases.findById(phaseId);
          if (phase) await this.publishDrainForPhase(phase);
        }
      }
    }
    return { invalidated, phaseIds, placesFlushed };
  }
}

