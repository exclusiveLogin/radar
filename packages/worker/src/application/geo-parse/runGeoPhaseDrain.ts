import type {
  IPhaseRunRepository,
  IPlaceEnrichmentJobRepository,
  PhaseDefinitionRecord,
  PhaseRunStats,
  PhaseTrigger,
} from "@radar/shared";
import { resolveGeoEnrichmentProvider } from "@radar/shared";
import type { PlaceEnrichmentRunner } from "./placeEnrichmentRunner.js";

export type GeoPhaseDrainDeps = {
  placeEnrichmentRunner: PlaceEnrichmentRunner;
  placeEnrichmentJobs: IPlaceEnrichmentJobRepository;
  phaseRuns: IPhaseRunRepository;
  resolveRunForTick(input: {
    phase: PhaseDefinitionRecord;
    trigger: PhaseTrigger;
    existingRunId?: string;
  }): Promise<{ id: string }>;
  resolveRunContinuation(runId: string): Promise<"continue" | "cancel" | "pause">;
  finalizeRun(
    runId: string,
    status: "completed" | "canceled" | "paused",
    stats: PhaseRunStats,
  ): Promise<void>;
};

/** Drain geoParse: catch-up place jobs + батчи PlaceEnrichmentRunner. */
export async function runGeoPhaseDrain(
  deps: GeoPhaseDrainDeps,
  input: {
    phase: PhaseDefinitionRecord;
    runId: string;
    batchSize: number;
    trigger: PhaseTrigger;
    placeIds?: string[];
  },
): Promise<PhaseRunStats> {
  const runner = deps.placeEnrichmentRunner;
  const provider = resolveGeoEnrichmentProvider(input.phase);
  if (!provider) {
    throw new Error(`geo phase ${input.phase.id} has no provider enricher`);
  }
  if (input.placeIds?.length) {
    for (const placeId of input.placeIds) {
      await deps.placeEnrichmentJobs.enqueue(placeId, provider);
    }
  }

  const run = await deps.resolveRunForTick({
    phase: input.phase,
    trigger: input.trigger,
    existingRunId: input.runId,
  });
  await deps.phaseRuns.appendLog(run.id, {
    at: new Date().toISOString(),
    level: "info",
    message: `${input.trigger} geo drain provider=${provider}`,
  });

  let totals: PhaseRunStats = { claimed: 0, processed: 0, ok: 0, failed: 0 };
  try {
    for (;;) {
      const control = await deps.resolveRunContinuation(run.id);
      if (control === "cancel") {
        await deps.finalizeRun(run.id, "canceled", totals);
        return totals;
      }
      if (control === "pause") {
        await deps.finalizeRun(run.id, "paused", totals);
        return totals;
      }

      const batch = input.placeIds?.length
        ? await runner.runBatch(provider, input.batchSize, { phaseId: input.phase.id }, input.placeIds)
        : await runner.runBatch(provider, input.batchSize, { phaseId: input.phase.id });
      totals.claimed = (totals.claimed ?? 0) + batch.claimed;
      totals.processed = (totals.processed ?? 0) + batch.processed;
      totals.ok = (totals.ok ?? 0) + batch.processed;
      totals.failed = (totals.failed ?? 0) + batch.failed;

      if (input.placeIds?.length) {
        await deps.finalizeRun(run.id, "completed", totals);
        return totals;
      }

      const jobCounts = await deps.placeEnrichmentJobs.countByStatus(provider);
      totals.pendingRemaining = jobCounts.pending + jobCounts.processing;
      totals.totalKnown =
        (totals.ok ?? 0) + (totals.failed ?? 0) + totals.pendingRemaining;
      await deps.phaseRuns.updateStats(run.id, totals);
      await deps.phaseRuns.appendLog(run.id, {
        at: new Date().toISOString(),
        level: "info",
        message: `geo batch claimed=${batch.claimed} ok=${batch.processed} failed=${batch.failed} pending=${totals.pendingRemaining ?? 0}`,
      });

      if (batch.claimed === 0) {
        const counts = await deps.placeEnrichmentJobs.countByStatus(provider);
        totals.pendingRemaining = counts.pending + counts.processing;
        totals.totalKnown =
          (totals.ok ?? 0) + (totals.failed ?? 0) + totals.pendingRemaining;
        const idleOutcome = await deps.resolveRunContinuation(run.id);
        const status =
          idleOutcome === "cancel"
            ? "canceled"
            : idleOutcome === "pause"
              ? "paused"
              : "completed";
        await deps.finalizeRun(run.id, status, totals);
        return totals;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.phaseRuns.appendLog(run.id, {
      at: new Date().toISOString(),
      level: "error",
      message,
    });
    await deps.phaseRuns.updateStatus(run.id, "failed", { error: message });
    throw err;
  }
}