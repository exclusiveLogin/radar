import type {
  IPhaseCoverageRepository,
  IPhaseDefinitionRepository,
  PhaseCoverageTask,
  PhaseDefinitionRecord,
  PhaseRunStats,
  PhaseTrigger,
} from "@radar/shared";
import type { ParsePhaseTool } from "../parse/parsePhaseTool.js";
import { prerequisitePhaseIds } from "./phaseOrder.js";
import type { PhaseRunSession } from "./phaseRunSession.js";

const DRAIN_IDLE_POLL_MS = 250;

function waitForDrainProgress(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, DRAIN_IDLE_POLL_MS));
}

export type PhaseRunnerDeps = {
  parseTool: ParsePhaseTool;
  session: PhaseRunSession;
  coverage: IPhaseCoverageRepository;
  phaseDefinitions: IPhaseDefinitionRepository;
};

/**
 * Legacy parse drain (CLI / manual poller): coverage claim → parseTool → mark.
 * Mill/daemon идут через UnifiedRunner + PhaseDriver; geo — через runGeoPhaseDrain.
 */
export class PhaseRunner {
  constructor(private readonly deps: PhaseRunnerDeps) {}

  /** Domain eval одной parse-задачи — без mark (UnifiedRunner закрывает через IWorkQueue). */
  async handleParseTask(phase: PhaseDefinitionRecord, task: PhaseCoverageTask): Promise<void> {
    await this.deps.parseTool.run(phase, task);
  }

  async runBatch(input: {
    phase: PhaseDefinitionRecord;
    runId: string;
    trigger: PhaseTrigger;
    tasks: PhaseCoverageTask[];
    onProgress?: (stats: PhaseRunStats) => void;
  }): Promise<PhaseRunStats> {
    const stats: PhaseRunStats = {
      claimed: input.tasks.length,
      processed: 0,
      ok: 0,
      failed: 0,
    };

    for (const task of input.tasks) {
      const continuation = await this.deps.session.resolveContinuation(input.runId);
      if (continuation === "cancel") break;
      if (continuation === "pause") {
        await this.deps.session.phaseRuns.updateStatus(input.runId, "paused");
        break;
      }

      try {
        await this.deps.parseTool.run(input.phase, task);
        await this.deps.coverage.markDone(task.id);
        stats.ok += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.deps.coverage.markFailed(task.id, message);
        stats.failed += 1;
      }
      stats.processed += 1;
      input.onProgress?.(stats);
    }

    const counts = await this.deps.coverage.countByStatus(input.phase.id);
    stats.pendingRemaining = counts.pending + counts.processing;
    stats.totalKnown =
      counts.pending + counts.processing + counts.done + counts.failed;
    await this.deps.session.phaseRuns.updateStats(input.runId, stats);
    await this.deps.session.phaseRuns.appendLog(input.runId, {
      at: new Date().toISOString(),
      level: "info",
      message: `processed=${stats.processed} ok=${stats.ok} failed=${stats.failed} pending=${stats.pendingRemaining ?? 0}`,
    });

    return stats;
  }

  /**
   * Drain ingestParse: батчи claim до пустой очереди, один phase_run.
   * geoParse сюда не входит — composition/CLI зовут runGeoPhaseDrain.
   */
  async runDrain(input: {
    phase: PhaseDefinitionRecord;
    runId: string;
    batchSize: number;
    trigger: PhaseTrigger;
    materializationIds?: string[];
    placeIds?: string[];
    /** Снимок накопленного результата после каждого завершённого batch. */
    onProgress?: (stats: PhaseRunStats) => void;
  }): Promise<PhaseRunStats> {
    if (input.phase.scope === "geoParse") {
      throw new Error(
        `PhaseRunner.runDrain: geoParse вне scope — используйте runGeoPhaseDrain (phase=${input.phase.id})`,
      );
    }
    const run = await this.deps.session.resolveForTick({
      phase: input.phase,
      trigger: input.trigger,
      existingRunId: input.runId,
    });
    await this.deps.session.phaseRuns.appendLog(run.id, {
      at: new Date().toISOString(),
      level: "info",
      message: `${input.trigger} drain started phase=${input.phase.id} batchSize=${input.batchSize}`,
    });

    const enabledPhases = await this.deps.phaseDefinitions.listEnabled(
      undefined,
      "ingestParse",
    );
    const prereqIds = prerequisitePhaseIds(input.phase, enabledPhases);
    if (input.materializationIds?.length) {
      for (const rawMessageId of input.materializationIds) {
        await this.deps.coverage.enqueuePending({
          rawMessageId,
          phaseId: input.phase.id,
        });
      }
    }
    let totals: PhaseRunStats = {
      claimed: 0,
      processed: 0,
      ok: 0,
      failed: 0,
    };

    try {
      for (;;) {
        const beforeBatch = await this.deps.session.resolveContinuation(run.id);
        if (beforeBatch === "cancel") {
          await this.deps.session.finalize(run.id, "canceled", totals);
          return totals;
        }
        if (beforeBatch === "pause") {
          await this.deps.session.finalize(run.id, "paused", totals);
          return totals;
        }

        const tasks = input.materializationIds?.length
          ? await this.deps.coverage.claimForRawMessages(
              input.phase.id,
              input.materializationIds,
              prereqIds,
            )
          : await this.deps.coverage.claimBatch(
              input.phase.id,
              input.batchSize,
              prereqIds,
            );
        await this.deps.session.phaseRuns.appendLog(run.id, {
          at: new Date().toISOString(),
          level: "info",
          message: `claimed batch=${tasks.length}`,
        });

        if (tasks.length === 0) {
          const counts = await this.deps.coverage.countByStatus(input.phase.id);
          totals.pendingRemaining = counts.pending + counts.processing;
          totals.totalKnown =
            counts.pending + counts.processing + counts.done + counts.failed;
          await this.deps.session.phaseRuns.appendLog(run.id, {
            at: new Date().toISOString(),
            level: "info",
            message: `drain idle pending=${totals.pendingRemaining ?? 0}`,
          });
          const idleOutcome = await this.deps.session.resolveContinuation(run.id);
          if (idleOutcome === "cancel") {
            await this.deps.session.finalize(run.id, "canceled", totals);
            return totals;
          }
          if (idleOutcome === "pause") {
            await this.deps.session.finalize(run.id, "paused", totals);
            return totals;
          }
          if (totals.pendingRemaining > 0) {
            await waitForDrainProgress();
            continue;
          }
          await this.deps.session.finalize(run.id, "completed", totals);
          return totals;
        }

        const batchStats = await this.runBatch({
          phase: input.phase,
          runId: run.id,
          trigger: input.trigger,
          tasks,
          onProgress: (batchProgress) => {
            input.onProgress?.(mergePhaseRunStats(totals, batchProgress));
          },
        });
        totals = mergePhaseRunStats(totals, batchStats);
        input.onProgress?.(totals);

        if (input.materializationIds?.length) {
          await this.deps.session.finalize(run.id, "completed", totals);
          return totals;
        }

        const afterBatch = await this.deps.session.resolveContinuation(run.id);
        if (afterBatch === "cancel") {
          await this.deps.session.finalize(run.id, "canceled", totals);
          return totals;
        }
        if (afterBatch === "pause") {
          await this.deps.session.finalize(run.id, "paused", totals);
          return totals;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.deps.session.phaseRuns.appendLog(run.id, {
        at: new Date().toISOString(),
        level: "error",
        message,
      });
      await this.deps.session.phaseRuns.updateStatus(run.id, "failed", { error: message });
      throw err;
    }
  }

  /** Полный тик scheduled/manual: claim → run → finalize run. */
  async runPhaseTick(input: {
    phase: PhaseDefinitionRecord;
    trigger: PhaseTrigger;
    batchSize: number;
    /** Запись из админки (pending) — не создавать дубликат phase_run. */
    existingRunId?: string;
  }): Promise<PhaseRunStats> {
    if (input.phase.scope === "geoParse") {
      throw new Error(
        `PhaseRunner.runPhaseTick: geoParse вне scope — используйте runGeoPhaseDrain (phase=${input.phase.id})`,
      );
    }
    const run = await this.deps.session.resolveForTick(input);
    await this.deps.session.phaseRuns.appendLog(run.id, {
      at: new Date().toISOString(),
      level: "info",
      message: input.existingRunId
        ? `run picked up phase=${input.phase.id} trigger=${input.trigger}`
        : `run started phase=${input.phase.id} trigger=${input.trigger}`,
    });

    try {
      const enabledPhases = await this.deps.phaseDefinitions.listEnabled(
        undefined,
        "ingestParse",
      );
      const prereqIds = prerequisitePhaseIds(input.phase, enabledPhases);
      const tasks = await this.deps.coverage.claimBatch(
        input.phase.id,
        input.batchSize,
        prereqIds,
      );
      await this.deps.session.phaseRuns.appendLog(run.id, {
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
        await this.deps.session.phaseRuns.appendLog(run.id, {
          at: new Date().toISOString(),
          level: "info",
          message: `no eligible work pending=${empty.pendingRemaining ?? 0}`,
        });
        const idleOutcome = await this.deps.session.resolveContinuation(run.id);
        const idleStatus =
          idleOutcome === "cancel"
            ? "canceled"
            : idleOutcome === "pause"
              ? "paused"
              : "completed";
        await this.deps.session.finalize(run.id, idleStatus, empty);
        return empty;
      }

      const stats = await this.runBatch({
        phase: input.phase,
        runId: run.id,
        trigger: input.trigger,
        tasks,
      });

      const outcome = await this.deps.session.resolveContinuation(run.id);
      const finalStatus =
        outcome === "cancel"
          ? "canceled"
          : outcome === "pause"
            ? "paused"
            : "completed";
      await this.deps.session.finalize(run.id, finalStatus, stats);
      return stats;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.deps.session.phaseRuns.appendLog(run.id, {
        at: new Date().toISOString(),
        level: "error",
        message,
      });
      await this.deps.session.phaseRuns.updateStatus(run.id, "failed", { error: message });
      throw err;
    }
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
