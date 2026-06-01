import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import {
  manualRunScopeSchema,
  phaseReplayRequestSchema,
  type ManualRunScope,
  type PhaseDefinitionRecord,
  type PhaseRun,
} from "@radar/shared";
import { DataSource } from "typeorm";
import {
  TypeOrmPhaseCoverageRepository,
  TypeOrmPhaseDefinitionRepository,
  TypeOrmPhaseRunRepository,
} from "../infrastructure/persistence";

/** Админка Phase-pipeline v2: фазы, runs, replay. */
@Injectable()
export class PhasesAdminService {
  private readonly phases: TypeOrmPhaseDefinitionRepository;
  private readonly coverage: TypeOrmPhaseCoverageRepository;
  private readonly runs: TypeOrmPhaseRunRepository;

  constructor(@InjectDataSource() dataSource: DataSource) {
    this.phases = new TypeOrmPhaseDefinitionRepository(dataSource);
    this.coverage = new TypeOrmPhaseCoverageRepository(dataSource);
    this.runs = new TypeOrmPhaseRunRepository(dataSource);
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
      if (patch.enabled) {
        await this.coverage.enqueueCatchUp(id);
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

  async runsOverview(): Promise<{
    runningCount: number;
    byPhase: Array<{
      phaseId: string;
      activeRun: PhaseRun | null;
      coverage: Record<string, number>;
    }>;
  }> {
    const allPhases = await this.phases.listAll();
    const active = await this.runs.list({ status: "running", limit: 50 });
    const byPhase = await Promise.all(
      allPhases.map(async (phase) => {
        const coverage = await this.coverage.countByStatus(phase.id);
        const activeRun = active.find((r) => r.phaseId === phase.id) ?? null;
        return { phaseId: phase.id, activeRun, coverage };
      }),
    );
    return { runningCount: active.length, byPhase };
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

  /** Manual run: enqueue всех не-done + drain батчами в воркере (PhaseManualRunPoller). */
  async startRun(phaseId: string, body: unknown): Promise<PhaseRun> {
    const phase = await this.getPhase(phaseId);
    const scope = manualRunScopeSchema.safeParse(body ?? {});
    if (!scope.success) throw new BadRequestException(scope.error.issues);

    const run = await this.runs.create({ phaseId, trigger: "manual", status: "pending" });
    const rawIds = await this.runs.findRawIdsForManualRun(phaseId, scope.data);
    for (const rawMessageId of rawIds) {
      await this.coverage.enqueuePending({ rawMessageId, phaseId });
    }
    await this.runs.appendLog(run.id, {
      at: new Date().toISOString(),
      level: "info",
      message: `manual enqueue ${rawIds.length} messages`,
    });
    return run;
  }

  async cancelRun(id: string): Promise<{ ok: true }> {
    await this.getRun(id);
    await this.runs.requestControl(id, "cancel");
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

  async forceStopRun(id: string): Promise<{ ok: true; reset: number }> {
    const run = await this.getRun(id);
    const reset = await this.coverage.resetProcessingForPhase(run.phaseId);
    await this.runs.updateStatus(run.id, "canceled");
    return { ok: true, reset };
  }

  async replay(body: unknown): Promise<{ invalidated: number; phaseIds: string[] }> {
    const parsed = phaseReplayRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    const { phaseIds, invalidateCoverage } = parsed.data;
    let invalidated = 0;
    if (invalidateCoverage) {
      invalidated = await this.coverage.invalidateForPhases(phaseIds);
      for (const phaseId of phaseIds) {
        await this.coverage.enqueueCatchUp(phaseId);
      }
    }
    return { invalidated, phaseIds };
  }

}
