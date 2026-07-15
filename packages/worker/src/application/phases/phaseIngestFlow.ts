import type { IPhaseDefinitionRepository, IRawMessageRepository } from "@radar/shared";
import type { PhaseRunner } from "./phaseRunner.js";
import { sortPhasesByOrder } from "./phaseOrder.js";

export type PhaseIngestFlowDeps = {
  rawMessages: IRawMessageRepository;
  phases: IPhaseDefinitionRepository;
  runner: PhaseRunner;
};

export type PhaseIngestFlowOptions = {
  /** Bulk reparse: пропустить inline eager. */
  skipInlineEager?: boolean;
};

/**
 * Post-ingest SSOT: только inline eager. Очередь — через RMQ → planPendingForIds.
 */
export async function runPostIngestPhaseFlow(
  deps: PhaseIngestFlowDeps,
  rawMessageId: string,
  options: PhaseIngestFlowOptions = {},
): Promise<void> {
  const raw = await deps.rawMessages.findById(rawMessageId);
  if (!raw?.id) return;

  if (options.skipInlineEager) return;

  const eagerPhases = sortPhasesByOrder(
    (await deps.phases.listEnabled("eager", "ingestParse")).filter(
      (p) => p.policy.eagerMode === "inline",
    ),
  );

  for (const phase of eagerPhases) {
    try {
      await deps.runner.runInline(phase, rawMessageId);
    } catch (err) {
      console.error(`PhaseIngest[eager:${phase.id}]:`, err);
    }
  }
}
