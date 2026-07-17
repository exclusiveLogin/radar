import type {
  IPhaseCoverageRepository,
  IWorkQueue,
  PhaseCoverageTask,
} from "@radar/shared";

export type ParsePhaseQueueDeps = {
  coverage: IPhaseCoverageRepository;
  phaseId: string;
  materializationIds?: string[];
  prerequisitePhaseIds?: string[];
};

/** IWorkQueue adapter для job_parse_phase. */
export function createParsePhaseQueue(
  deps: ParsePhaseQueueDeps,
): IWorkQueue<PhaseCoverageTask> {
  return {
    async planPending(limit?: number) {
      if (deps.materializationIds?.length) {
        const result = await deps.coverage.planPendingForIds(
          deps.phaseId,
          deps.materializationIds,
        );
        return { planned: result.planned };
      }
      const result = await deps.coverage.enqueueCatchUp(deps.phaseId);
      return { planned: limit ? Math.min(result.enqueued, limit) : result.enqueued };
    },
    claimBatch(limit) {
      if (deps.materializationIds?.length) {
        return deps.coverage.claimForRawMessages(
          deps.phaseId,
          deps.materializationIds,
          deps.prerequisitePhaseIds,
        );
      }
      return deps.coverage.claimBatch(
        deps.phaseId,
        limit,
        deps.prerequisitePhaseIds,
      );
    },
    markCompleted(id) {
      return deps.coverage.markDone(id);
    },
    markFailed(id, error) {
      return deps.coverage.markFailed(id, error);
    },
  };
}
