import type {
  IPlaceEnrichmentJobRepository,
  PhaseDefinitionRecord,
  PhaseRunStats,
  PhaseTrigger,
} from "@radar/shared";
import { resolveGeoEnrichmentProvider } from "@radar/shared";
import type { PhaseRunSession } from "../phases/phaseRunSession.js";
import type { PlaceEnrichmentRunner } from "./placeEnrichmentRunner.js";

export type GeoPhaseDrainDeps = {
  placeEnrichmentRunner: PlaceEnrichmentRunner;
  placeEnrichmentJobs: IPlaceEnrichmentJobRepository;
  session: PhaseRunSession;
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
  const { session, placeEnrichmentJobs, placeEnrichmentRunner: runner } = deps;
  const provider = resolveGeoEnrichmentProvider(input.phase);
  if (!provider) {
    throw new Error(`geo phase ${input.phase.id} has no provider enricher`);
  }
  if (input.placeIds?.length) {
    for (const placeId of input.placeIds) {
      await placeEnrichmentJobs.enqueue(placeId, provider);
    }
  }

  const run = await session.resolveForTick({
    phase: input.phase,
    trigger: input.trigger,
    existingRunId: input.runId,
  });
  await session.phaseRuns.appendLog(run.id, {
    at: new Date().toISOString(),
    level: "info",
    message: `${input.trigger} geo drain provider=${provider}`,
  });

  const totals: PhaseRunStats = { claimed: 0, processed: 0, ok: 0, failed: 0 };
  try {
    for (;;) {
      const control = await session.resolveContinuation(run.id);
      if (control === "cancel") {
        await session.finalize(run.id, "canceled", totals);
        return totals;
      }
      if (control === "pause") {
        await session.finalize(run.id, "paused", totals);
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
        await session.finalize(run.id, "completed", totals);
        return totals;
      }

      const jobCounts = await placeEnrichmentJobs.countByStatus(provider);
      totals.pendingRemaining = jobCounts.pending + jobCounts.processing;
      totals.totalKnown =
        (totals.ok ?? 0) + (totals.failed ?? 0) + totals.pendingRemaining;
      await session.phaseRuns.updateStats(run.id, totals);
      await session.phaseRuns.appendLog(run.id, {
        at: new Date().toISOString(),
        level: "info",
        message: `geo batch claimed=${batch.claimed} ok=${batch.processed} failed=${batch.failed} pending=${totals.pendingRemaining ?? 0}`,
      });

      if (batch.claimed === 0) {
        const counts = await placeEnrichmentJobs.countByStatus(provider);
        totals.pendingRemaining = counts.pending + counts.processing;
        totals.totalKnown =
          (totals.ok ?? 0) + (totals.failed ?? 0) + totals.pendingRemaining;
        const idleOutcome = await session.resolveContinuation(run.id);
        const status =
          idleOutcome === "cancel"
            ? "canceled"
            : idleOutcome === "pause"
              ? "paused"
              : "completed";
        await session.finalize(run.id, status, totals);
        return totals;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await session.phaseRuns.appendLog(run.id, {
      at: new Date().toISOString(),
      level: "error",
      message,
    });
    await session.phaseRuns.updateStatus(run.id, "failed", { error: message });
    throw err;
  }
}
