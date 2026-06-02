import type { IPhaseDefinitionRepository, IRawMessageRepository } from "@radar/shared";
import type { CoverageEnqueuer } from "./coverageEnqueuer.js";
import type { PhaseRunner } from "./phaseRunner.js";
import { sortPhasesByOrder } from "./phaseOrder.js";

export type PhaseIngestFlowDeps = {
  rawMessages: IRawMessageRepository;
  phases: IPhaseDefinitionRepository;
  enqueuer: CoverageEnqueuer;
  runner: PhaseRunner;
};

/**
 * Тот же путь, что после ingest: coverage pending + inline eager по order.
 * Reparse и RawMessageIngested используют эту функцию (SSOT).
 */
export async function runPostIngestPhaseFlow(
  deps: PhaseIngestFlowDeps,
  rawMessageId: string,
): Promise<void> {
  const raw = await deps.rawMessages.findById(rawMessageId);
  if (!raw?.id) return;

  await deps.enqueuer.onNewRawMessage(rawMessageId);

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
