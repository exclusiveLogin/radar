import type {
  IEventLocationRepository,
  IEventPublisher,
  IParsedEventRepository,
  IPhaseCoverageRepository,
  IPhaseDefinitionRepository,
  IPhaseRunRepository,
  IPlaceCacheRepository,
  IRawMessageRepository,
  PhaseCoverageTask,
  PhaseDefinitionRecord,
  PhaseRunStats,
  PhaseTrigger,
} from "@radar/shared";
import { loadLlmRuntimeConfig } from "../../infrastructure/enrichers/llmRuntimeConfig.js";
import { ParseRawMessageHandler } from "../handlers/parseRawMessageHandler.js";
import { createParsePipeline } from "../parsing/createParsePipeline.js";
import type { GeoValidationService } from "../parsing/geoValidationService.js";
import { pipelineConfigFromEnrichers } from "./phasePipelineConfig.js";
import { prerequisitePhaseIds } from "./phaseOrder.js";

export type PhaseRunnerDeps = {
  rawMessages: IRawMessageRepository;
  coverage: IPhaseCoverageRepository;
  phaseDefinitions: IPhaseDefinitionRepository;
  phaseRuns: IPhaseRunRepository;
  parsedEvents: IParsedEventRepository;
  eventLocations: IEventLocationRepository;
  validation: GeoValidationService;
  placeCache: IPlaceCacheRepository;
  events: IEventPublisher;
};

/**
 * Единое ядро исполнения фазы: загрузка накопителя, enrichers[] фазы, merge, coverage.
 */
export class PhaseRunner {
  constructor(private readonly deps: PhaseRunnerDeps) {}

  private createHandler(phase: PhaseDefinitionRecord): ParseRawMessageHandler {
    const { flags, order } = pipelineConfigFromEnrichers(phase.enrichers);
    const llmRuntimeConfig = {
      ...loadLlmRuntimeConfig(),
      ...(flags.llm ? { enabled: true } : {}),
    };
    const { pipeline } = createParsePipeline(
      { enricherFlags: flags, pipelineOrder: order, llmRuntimeConfig },
      this.deps.placeCache,
    );
    // Фазовый пайплайн (llm/catalog/…) — только inline; ingest pool = catalog-only.
    return new ParseRawMessageHandler(
      pipeline,
      this.deps.parsedEvents,
      this.deps.eventLocations,
      this.deps.validation,
      this.deps.placeCache,
      this.deps.events,
    );
  }

  /** Inline eager: одно сообщение без claim из очереди. */
  async runInline(phase: PhaseDefinitionRecord, rawMessageId: string): Promise<void> {
    const raw = await this.deps.rawMessages.findById(rawMessageId);
    if (!raw?.id) return;
    const handler = this.createHandler(phase);
    await handler.handle(raw);
    await this.deps.coverage.markDoneForMessage(rawMessageId, phase.id);
  }

  /** Прогон claim-batch с phase_run и cooperative control. */
  async runBatch(input: {
    phase: PhaseDefinitionRecord;
    runId: string;
    trigger: PhaseTrigger;
    tasks: PhaseCoverageTask[];
  }): Promise<PhaseRunStats> {
    const handler = this.createHandler(input.phase);
    const stats: PhaseRunStats = {
      claimed: input.tasks.length,
      processed: 0,
      ok: 0,
      failed: 0,
    };

    for (const task of input.tasks) {
      const control = await this.deps.phaseRuns.getControl(input.runId);
      if (control === "cancel") break;
      if (control === "pause") {
        await this.deps.phaseRuns.updateStatus(input.runId, "paused");
        break;
      }

      try {
        const raw = await this.deps.rawMessages.findById(task.rawMessageId);
        if (!raw?.id) {
          await this.deps.coverage.markFailed(task.id, "raw_message not found");
          stats.failed += 1;
        } else {
          await handler.handle(raw);
          await this.deps.coverage.markDone(task.id);
          stats.ok += 1;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.deps.coverage.markFailed(task.id, message);
        stats.failed += 1;
      }
      stats.processed += 1;

      const counts = await this.deps.coverage.countByStatus(input.phase.id);
      stats.pendingRemaining = counts.pending + counts.processing;
      stats.totalKnown =
        counts.pending + counts.processing + counts.done + counts.failed;
      await this.deps.phaseRuns.updateStats(input.runId, stats);
      await this.deps.phaseRuns.appendLog(input.runId, {
        at: new Date().toISOString(),
        level: "info",
        message: `processed=${stats.processed} ok=${stats.ok} failed=${stats.failed} pending=${stats.pendingRemaining ?? 0}`,
      });
    }

    return stats;
  }

  /**
   * Drain: батчи claim до пустой очереди, один phase_run (manual / scheduled).
   */
  async runDrain(input: {
    phase: PhaseDefinitionRecord;
    runId: string;
    batchSize: number;
    trigger: PhaseTrigger;
  }): Promise<PhaseRunStats> {
    const run = await this.resolveRunForTick({
      phase: input.phase,
      trigger: input.trigger,
      existingRunId: input.runId,
    });
    await this.deps.phaseRuns.appendLog(run.id, {
      at: new Date().toISOString(),
      level: "info",
      message: `${input.trigger} drain started phase=${input.phase.id} batchSize=${input.batchSize}`,
    });

    const enabledPhases = await this.deps.phaseDefinitions.listEnabled();
    const prereqIds = prerequisitePhaseIds(input.phase, enabledPhases);
    let totals: PhaseRunStats = {
      claimed: 0,
      processed: 0,
      ok: 0,
      failed: 0,
    };

    try {
      for (;;) {
        const controlBefore = await this.deps.phaseRuns.getControl(run.id);
        if (controlBefore === "cancel") {
          await this.finalizeRun(run.id, "canceled", totals);
          return totals;
        }
        if (controlBefore === "pause") {
          await this.finalizeRun(run.id, "paused", totals);
          return totals;
        }

        const tasks = await this.deps.coverage.claimBatch(
          input.phase.id,
          input.batchSize,
          prereqIds,
        );
        await this.deps.phaseRuns.appendLog(run.id, {
          at: new Date().toISOString(),
          level: "info",
          message: `claimed batch=${tasks.length}`,
        });

        if (tasks.length === 0) {
          const counts = await this.deps.coverage.countByStatus(input.phase.id);
          totals.pendingRemaining = counts.pending + counts.processing;
          totals.totalKnown =
            counts.pending + counts.processing + counts.done + counts.failed;
          await this.deps.phaseRuns.appendLog(run.id, {
            at: new Date().toISOString(),
            level: "info",
            message: `drain idle pending=${totals.pendingRemaining ?? 0}`,
          });
          await this.finalizeRun(run.id, "completed", totals);
          return totals;
        }

        const batchStats = await this.runBatch({
          phase: input.phase,
          runId: run.id,
          trigger: input.trigger,
          tasks,
        });
        totals = mergePhaseRunStats(totals, batchStats);

        const controlAfter = await this.deps.phaseRuns.getControl(run.id);
        if (controlAfter === "cancel") {
          await this.finalizeRun(run.id, "canceled", totals);
          return totals;
        }
        if (controlAfter === "pause") {
          await this.finalizeRun(run.id, "paused", totals);
          return totals;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.deps.phaseRuns.appendLog(run.id, {
        at: new Date().toISOString(),
        level: "error",
        message,
      });
      await this.deps.phaseRuns.updateStatus(run.id, "failed", { error: message });
      throw err;
    }
  }

  /** @deprecated используй runDrain */
  async runManualRunDrain(input: {
    phase: PhaseDefinitionRecord;
    runId: string;
    batchSize: number;
  }): Promise<PhaseRunStats> {
    return this.runDrain({ ...input, trigger: "manual" });
  }

  /** Полный тик scheduled/manual: claim → run → finalize run. */
  async runPhaseTick(input: {
    phase: PhaseDefinitionRecord;
    trigger: PhaseTrigger;
    batchSize: number;
    /** Запись из админки (pending) — не создавать дубликат phase_run. */
    existingRunId?: string;
  }): Promise<PhaseRunStats> {
    const run = await this.resolveRunForTick(input);
    await this.deps.phaseRuns.appendLog(run.id, {
      at: new Date().toISOString(),
      level: "info",
      message: input.existingRunId
        ? `run picked up phase=${input.phase.id} trigger=${input.trigger}`
        : `run started phase=${input.phase.id} trigger=${input.trigger}`,
    });

    try {
      const enabledPhases = await this.deps.phaseDefinitions.listEnabled();
      const prereqIds = prerequisitePhaseIds(input.phase, enabledPhases);
      const tasks = await this.deps.coverage.claimBatch(
        input.phase.id,
        input.batchSize,
        prereqIds,
      );
      await this.deps.phaseRuns.appendLog(run.id, {
        at: new Date().toISOString(),
        level: "info",
        message: `claimed batch=${tasks.length}`,
      });

      if (tasks.length === 0) {
        const counts = await this.deps.coverage.countByStatus(input.phase.id);
        const empty: PhaseRunStats = {
          claimed: 0,
          processed: 0,
          ok: 0,
          failed: 0,
          pendingRemaining: counts.pending + counts.processing,
          totalKnown:
            counts.pending + counts.processing + counts.done + counts.failed,
        };
        await this.deps.phaseRuns.appendLog(run.id, {
          at: new Date().toISOString(),
          level: "info",
          message: `no eligible work pending=${empty.pendingRemaining ?? 0}`,
        });
        await this.deps.phaseRuns.updateStatus(run.id, "completed", { stats: empty });
        return empty;
      }

      const stats = await this.runBatch({
        phase: input.phase,
        runId: run.id,
        trigger: input.trigger,
        tasks,
      });

      const control = await this.deps.phaseRuns.getControl(run.id);
      const finalStatus =
        control === "cancel"
          ? "canceled"
          : control === "pause"
            ? "paused"
            : "completed";
      await this.deps.phaseRuns.clearControl(run.id);
      await this.deps.phaseRuns.updateStatus(run.id, finalStatus, { stats });
      return stats;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.deps.phaseRuns.appendLog(run.id, {
        at: new Date().toISOString(),
        level: "error",
        message,
      });
      await this.deps.phaseRuns.updateStatus(run.id, "failed", { error: message });
      throw err;
    }
  }

  private async resolveRunForTick(input: {
    phase: PhaseDefinitionRecord;
    trigger: PhaseTrigger;
    existingRunId?: string;
  }) {
    if (!input.existingRunId) {
      return this.deps.phaseRuns.create({
        phaseId: input.phase.id,
        trigger: input.trigger,
        status: "running",
      });
    }

    const existing = await this.deps.phaseRuns.findById(input.existingRunId);
    if (!existing) {
      throw new Error(`phase run ${input.existingRunId} not found`);
    }
    if (existing.phaseId !== input.phase.id) {
      throw new Error(
        `phase run ${input.existingRunId} phase mismatch: ${existing.phaseId} vs ${input.phase.id}`,
      );
    }
    if (existing.status !== "pending") {
      throw new Error(
        `phase run ${input.existingRunId} not executable (status=${existing.status})`,
      );
    }
    await this.deps.phaseRuns.updateStatus(existing.id, "running");
    return existing;
  }

  private async finalizeRun(
    runId: string,
    status: "completed" | "canceled" | "paused",
    stats: PhaseRunStats,
  ): Promise<void> {
    await this.deps.phaseRuns.clearControl(runId);
    await this.deps.phaseRuns.updateStatus(runId, status, { stats });
  }
}

function mergePhaseRunStats(acc: PhaseRunStats, batch: PhaseRunStats): PhaseRunStats {
  return {
    claimed: (acc.claimed ?? 0) + (batch.claimed ?? 0),
    processed: (acc.processed ?? 0) + (batch.processed ?? 0),
    ok: (acc.ok ?? 0) + (batch.ok ?? 0),
    failed: (acc.failed ?? 0) + (batch.failed ?? 0),
    pendingRemaining: batch.pendingRemaining,
    totalKnown: batch.totalKnown,
  };
}
