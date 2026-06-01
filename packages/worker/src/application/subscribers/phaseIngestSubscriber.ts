import type { DomainEvent } from "@radar/shared";
import type { PhaseIngestFlowDeps } from "../phases/phaseIngestFlow.js";
import { runPostIngestPhaseFlow } from "../phases/phaseIngestFlow.js";

/**
 * RawMessageIngested → тот же SSOT-поток, что и reparse (phaseIngestFlow).
 */
export function createPhaseIngestHandler(
  deps: PhaseIngestFlowDeps,
): (event: DomainEvent) => Promise<void> {
  return async (event: DomainEvent) => {
    if (event.type !== "RawMessageIngested") return;
    const rawMessageId = event.aggregateId;
    if (!rawMessageId) return;
    await runPostIngestPhaseFlow(deps, rawMessageId);
  };
}
