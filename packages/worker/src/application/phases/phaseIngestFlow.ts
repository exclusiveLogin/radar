import type { IRawMessageRepository } from "@radar/shared";
import type { CoverageEnqueuer } from "./coverageEnqueuer.js";

export type PhaseIngestFlowDeps = {
  rawMessages: IRawMessageRepository;
  coverageEnqueuer: CoverageEnqueuer;
  /** Будит parse workload после planPending (RMQ wake / launcher.enqueue). */
  onWake?: () => void;
};

export type PhaseIngestFlowOptions = {
  /** Bulk reparse: plan всё равно; флаг оставлен для BC вызовов. */
  skipInlineEager?: boolean;
};

/**
 * Post-ingest SSOT: RMQ ids → planPendingForIds → wake drain.
 * Inline runInline удалён — единственный путь через job_parse_phase.
 */
export async function runPostIngestPhaseFlow(
  deps: PhaseIngestFlowDeps,
  rawMessageId: string,
  _options: PhaseIngestFlowOptions = {},
): Promise<void> {
  const raw = await deps.rawMessages.findById(rawMessageId);
  if (!raw?.id) return;

  await deps.coverageEnqueuer.planPendingForIds([rawMessageId]);
  deps.onWake?.();
}