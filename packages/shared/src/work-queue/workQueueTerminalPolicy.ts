/**
 * SSOT terminal/retry policy для job UPSERT (parse + geo).
 */

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

export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_RETRY_FAILED = true;
