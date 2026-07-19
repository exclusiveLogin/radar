/**
 * SSOT terminal/retry policy для job UPSERT (parse + geo).
 */
import { DEFAULT_PHASE_TERMINAL_POLICY } from "../schemas/enrichment/phaseTerminalPolicy.js";

export type WorkQueueTerminalInput = {
  attempts: number;
  maxAttempts: number;
  retryFailed: boolean;
};

/** После failed claim: retry → pending или terminal failed. */
export function resolveWorkQueueStatusAfterFailure(
  input: WorkQueueTerminalInput,
): "pending" | "failed" {
  const nextAttempt = input.attempts + 1;
  if (input.retryFailed && nextAttempt < input.maxAttempts) return "pending";
  return "failed";
}

/** @deprecated Используйте DEFAULT_PHASE_TERMINAL_POLICY. */
export const DEFAULT_MAX_ATTEMPTS = DEFAULT_PHASE_TERMINAL_POLICY.maxAttempts;
/** @deprecated Используйте DEFAULT_PHASE_TERMINAL_POLICY. */
export const DEFAULT_RETRY_FAILED = DEFAULT_PHASE_TERMINAL_POLICY.retryFailed;
