/**
 * Obs/control session для log_phase_run — не mill и не domain tool.
 */
import type {
  IPhaseRunRepository,
  PhaseDefinitionRecord,
  PhaseRun,
  PhaseRunStats,
  PhaseTrigger,
} from "@radar/shared";

export type PhaseRunSession = {
  resolveContinuation(runId: string): Promise<"continue" | "cancel" | "pause">;
  resolveForTick(input: {
    phase: PhaseDefinitionRecord;
    trigger: PhaseTrigger;
    existingRunId?: string;
  }): Promise<PhaseRun>;
  finalize(
    runId: string,
    status: "completed" | "canceled" | "paused",
    stats: PhaseRunStats,
  ): Promise<void>;
  readonly phaseRuns: IPhaseRunRepository;
};

export function createPhaseRunSession(
  phaseRuns: IPhaseRunRepository,
  onCompleted?: () => void,
): PhaseRunSession {
  return {
    phaseRuns,

    async resolveContinuation(runId) {
      const control = await phaseRuns.getControl(runId);
      if (control === "cancel") return "cancel";
      if (control === "pause") return "pause";
      const run = await phaseRuns.findById(runId);
      if (!run || (run.status !== "running" && run.status !== "pending")) {
        return "cancel";
      }
      return "continue";
    },

    async resolveForTick(input) {
      if (!input.existingRunId) {
        return phaseRuns.create({
          phaseId: input.phase.id,
          trigger: input.trigger,
          status: "running",
        });
      }

      const existing = await phaseRuns.findById(input.existingRunId);
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
        await phaseRuns.updateStatus(existing.id, "running");
      }
      return existing;
    },

    async finalize(runId, status, stats) {
      await phaseRuns.clearControl(runId);
      await phaseRuns.updateStatus(runId, status, { stats });
      if (status === "completed") {
        onCompleted?.();
      }
    },
  };
}
