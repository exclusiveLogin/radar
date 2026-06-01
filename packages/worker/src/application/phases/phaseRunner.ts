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
import type { ParseWorkerPool } from "../parsing/parseWorkerPool.js";
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
  parseWorkerPool?: ParseWorkerPool;
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
    return new ParseRawMessageHandler(
      pipeline,
      this.deps.parsedEvents,
      this.deps.eventLocations,
      this.deps.validation,
      this.deps.placeCache,
      this.deps.events,
      this.deps.parseWorkerPool,
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

  /** Полный тик scheduled/manual: claim → run → finalize run. */
  async runPhaseTick(input: {
    phase: PhaseDefinitionRecord;
    trigger: PhaseTrigger;
    batchSize: number;
  }): Promise<PhaseRunStats> {
    const run = await this.deps.phaseRuns.create({
      phaseId: input.phase.id,
      trigger: input.trigger,
      status: "running",
    });
    await this.deps.phaseRuns.appendLog(run.id, {
      at: new Date().toISOString(),
      level: "info",
      message: `run started phase=${input.phase.id} trigger=${input.trigger}`,
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

}
