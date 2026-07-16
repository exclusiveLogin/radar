import type { DomainEvent } from "@radar/shared";
import type { PhaseIngestFlowDeps } from "../phases/phaseIngestFlow.js";
import { runPostIngestPhaseFlow } from "../phases/phaseIngestFlow.js";
import { extractWakeIds } from "../runtime/workload/pipelineWakeContract.js";

/** RawMessageIngested → planPending(ids) + wake parse (без inline handle). */
export function createPhaseIngestHandler(
  deps: PhaseIngestFlowDeps,
): (event: DomainEvent) => Promise<void> {
  return async (event: DomainEvent) => {
    if (event.type !== "RawMessageIngested") return;
    const ids = extractWakeIds({
      aggregateId: event.aggregateId,
      payload: event.payload as Record<string, unknown>,
    });
    if (ids.length === 0) return;
    for (const rawMessageId of ids) {
      await runPostIngestPhaseFlow(deps, rawMessageId);
    }
  };
}