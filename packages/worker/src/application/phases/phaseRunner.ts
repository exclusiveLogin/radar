import type {
  IEventEvidenceRepository,
  IEventLocationRepository,
  IEventPublisher,
  IMessageParseWorkspaceRepository,
  IParsedEventRepository,
  IPhaseCoverageRepository,
  IPhaseDefinitionRepository,
  IPhaseRunRepository,
  IPlaceCacheRepository,
  IPlaceEnrichmentJobRepository,
  IPlaceRepository,
  IRawMessageRepository,
  IRegionRepository,
  IPlaceScanPort,
  PhaseCoverageTask,
  PhaseDefinitionRecord,
  PhaseRunStats,
  PhaseTrigger,
} from "@radar/shared";
import { resolveGeoEnrichmentProvider } from "@radar/shared";
import type { PlaceEnrichmentRunner } from "../geo-parse/placeEnrichmentRunner.js";
import { ParseRawMessageHandler } from "../handlers/parseRawMessageHandler.js";
import { createParseWorkspaceStack } from "../parse/createParseWorkspaceStack.js";
import type { ParsePhaseContext } from "../parse/parsePhaseContext.js";
import { resolvePhaseRunKind } from "../parse/parseWorkspaceRunModes.js";
import type { GeoValidationService } from "../parse/geoValidationService.js";
import { notifyMapPushSnapshotAfterPhase } from "../../infrastructure/notifyMapPushSnapshot.js";
import { prerequisitePhaseIds } from "./phaseOrder.js";

export type PhaseRunnerDeps = {
  rawMessages: IRawMessageRepository;
  coverage: IPhaseCoverageRepository;
  phaseDefinitions: IPhaseDefinitionRepository;
  phaseRuns: IPhaseRunRepository;
  parsedEvents: IParsedEventRepository;
  messageParseWorkspaces: IMessageParseWorkspaceRepository;
  eventLocations: IEventLocationRepository;
  eventEvidence: IEventEvidenceRepository;
  placeEnrichmentJobs: IPlaceEnrichmentJobRepository;
  places: IPlaceRepository;
  regions: IRegionRepository;
  validation: GeoValidationService;
  placeScan: IPlaceScanPort;
  placeCache: IPlaceCacheRepository;
  events: IEventPublisher;
  /** geoParse drain (place_enrichment_jobs). */
  placeEnrichmentRunner?: PlaceEnrichmentRunner;
};

/**
 * Единое ядро исполнения фазы: coverage claim → handler.
 *
 * Целевой контур phase job (lazy enrich): load workspace → enricher фазы → finalize.
 * Сейчас handler всё ещё rebuild-like через ParseWorkspaceMessageService.run().
 * @see ../parse/parseWorkspaceRunModes.ts
 */
export class PhaseRunner {
  constructor(private readonly deps: PhaseRunnerDeps) {}

  private createHandler(phase: PhaseDefinitionRecord): ParseRawMessageHandler {
    const phaseContext: ParsePhaseContext = {
      phaseId: phase.id,
      phaseMode: phase.enrichers.includes("llm") ? "enrich" : "baseline",
      enrichers: phase.enrichers,
      runKind: resolvePhaseRunKind(phase),
    };
    const { workspaceService } = createParseWorkspaceStack({
      placeScan: this.deps.placeScan,
      regions: this.deps.regions,
      places: this.deps.places,
      validation: this.deps.validation,
      parsedEvents: this.deps.parsedEvents,
      eventLocations: this.deps.eventLocations,
      messageParseWorkspaces: this.deps.messageParseWorkspaces,
    });
    return new ParseRawMessageHandler(
      workspaceService,
      this.deps.parsedEvents,
      this.deps.eventLocations,
      this.deps.eventEvidence,
      this.deps.events,
      phaseContext,
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
      const continuation = await this.resolveRunContinuation(input.runId);
      if (continuation === "cancel") break;
      if (continuation === "pause") {
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
    if (input.phase.scope === "geoParse") {
      return this.runGeoDrain(input);
    }
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

    const enabledPhases = await this.deps.phaseDefinitions.listEnabled(
      undefined,
      "ingestParse",
    );
    const prereqIds = prerequisitePhaseIds(input.phase, enabledPhases);
    let totals: PhaseRunStats = {
      claimed: 0,
      processed: 0,
      ok: 0,
      failed: 0,
    };

    try {
      for (;;) {
        const beforeBatch = await this.resolveRunContinuation(run.id);
        if (beforeBatch === "cancel") {
          await this.finalizeRun(run.id, "canceled", totals);
          return totals;
        }
        if (beforeBatch === "pause") {
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
          const idleOutcome = await this.resolveRunContinuation(run.id);
          if (idleOutcome === "cancel") {
            await this.finalizeRun(run.id, "canceled", totals);
            return totals;
          }
          if (idleOutcome === "pause") {
            await this.finalizeRun(run.id, "paused", totals);
            return totals;
          }
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

        const afterBatch = await this.resolveRunContinuation(run.id);
        if (afterBatch === "cancel") {
          await this.finalizeRun(run.id, "canceled", totals);
          return totals;
        }
        if (afterBatch === "pause") {
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

  /** Drain geoParse: catch-up place jobs + батчи PlaceEnrichmentRunner. */
  private async runGeoDrain(input: {
    phase: PhaseDefinitionRecord;
    runId: string;
    batchSize: number;
    trigger: PhaseTrigger;
  }): Promise<PhaseRunStats> {
    const runner = this.deps.placeEnrichmentRunner;
    if (!runner) {
      throw new Error("placeEnrichmentRunner not configured");
    }
    const provider = resolveGeoEnrichmentProvider(input.phase);
    if (!provider) {
      throw new Error(`geo phase ${input.phase.id} has no provider enricher`);
    }

    const run = await this.resolveRunForTick({
      phase: input.phase,
      trigger: input.trigger,
      existingRunId: input.runId,
    });
    await this.deps.phaseRuns.appendLog(run.id, {
      at: new Date().toISOString(),
      level: "info",
      message: `${input.trigger} geo drain provider=${provider}`,
    });

    let totals: PhaseRunStats = { claimed: 0, processed: 0, ok: 0, failed: 0 };
    try {
      for (;;) {
        const control = await this.resolveRunContinuation(run.id);
        if (control === "cancel") {
          await this.finalizeRun(run.id, "canceled", totals);
          return totals;
        }
        if (control === "pause") {
          await this.finalizeRun(run.id, "paused", totals);
          return totals;
        }

        const batch = await runner.runBatch(provider, input.batchSize);
        totals.claimed = (totals.claimed ?? 0) + batch.claimed;
        totals.processed = (totals.processed ?? 0) + batch.processed;
        totals.ok = (totals.ok ?? 0) + batch.processed;
        totals.failed = (totals.failed ?? 0) + batch.failed;

        const jobCounts = await this.deps.placeEnrichmentJobs.countByStatus(provider);
        totals.pendingRemaining = jobCounts.pending + jobCounts.processing;
        totals.totalKnown =
          (totals.ok ?? 0) +
          (totals.failed ?? 0) +
          totals.pendingRemaining;
        await this.deps.phaseRuns.updateStats(run.id, totals);
        await this.deps.phaseRuns.appendLog(run.id, {
          at: new Date().toISOString(),
          level: "info",
          message: `geo batch claimed=${batch.claimed} ok=${batch.processed} failed=${batch.failed} pending=${totals.pendingRemaining ?? 0}`,
        });

        if (batch.claimed === 0) {
          const counts = await this.deps.placeEnrichmentJobs.countByStatus(provider);
          totals.pendingRemaining = counts.pending + counts.processing;
          totals.totalKnown =
            (totals.ok ?? 0) + (totals.failed ?? 0) + totals.pendingRemaining;
          const idleOutcome = await this.resolveRunContinuation(run.id);
          const status =
            idleOutcome === "cancel"
              ? "canceled"
              : idleOutcome === "pause"
                ? "paused"
                : "completed";
          await this.finalizeRun(run.id, status, totals);
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
        const idleOutcome = await this.resolveRunContinuation(run.id);
        const idleStatus =
          idleOutcome === "cancel"
            ? "canceled"
            : idleOutcome === "pause"
              ? "paused"
              : "completed";
        await this.deps.phaseRuns.clearControl(run.id);
        await this.deps.phaseRuns.updateStatus(run.id, idleStatus, { stats: empty });
        return empty;
      }

      const stats = await this.runBatch({
        phase: input.phase,
        runId: run.id,
        trigger: input.trigger,
        tasks,
      });

      const outcome = await this.resolveRunContinuation(run.id);
      const finalStatus =
        outcome === "cancel"
          ? "canceled"
          : outcome === "pause"
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

  /** Cooperative cancel/pause + учёт status=canceled из админки. */
  private async resolveRunContinuation(
    runId: string,
  ): Promise<"continue" | "cancel" | "pause"> {
    const control = await this.deps.phaseRuns.getControl(runId);
    if (control === "cancel") return "cancel";
    if (control === "pause") return "pause";
    const run = await this.deps.phaseRuns.findById(runId);
    if (!run || (run.status !== "running" && run.status !== "pending")) {
      return "cancel";
    }
    return "continue";
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
    if (existing.status !== "pending" && existing.status !== "running") {
      throw new Error(
        `phase run ${input.existingRunId} not executable (status=${existing.status})`,
      );
    }
    if (existing.status === "pending") {
      await this.deps.phaseRuns.updateStatus(existing.id, "running");
    }
    return existing;
  }

  private async finalizeRun(
    runId: string,
    status: "completed" | "canceled" | "paused",
    stats: PhaseRunStats,
  ): Promise<void> {
    await this.deps.phaseRuns.clearControl(runId);
    await this.deps.phaseRuns.updateStatus(runId, status, { stats });
    if (status === "completed") {
      void notifyMapPushSnapshotAfterPhase();
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
