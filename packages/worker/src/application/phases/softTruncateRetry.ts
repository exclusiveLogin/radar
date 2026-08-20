import { isPgContendedL1ResetError } from "@radar/shared";
import { WipeTableLockError } from "../archive/wipeTableSql.js";

const DEFAULT_ATTEMPTS = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Soft-режим: повторяем только lock/deadlock contention без terminate backends. */
export function isSoftTruncateContention(error: unknown): boolean {
  return error instanceof WipeTableLockError || isPgContendedL1ResetError(error);
}

/**
 * Soft (forceLocks=false): retry deadlock/lock timeout без terminate.
 * Hard (forceLocks=true): без обёртки — retry+terminate внутри wipeTableSql.truncateTables.
 */
export async function withSoftTruncateRetry<T>(
  forceLocks: boolean,
  run: () => Promise<T>,
  options?: { attempts?: number; baseDelayMs?: number },
): Promise<T> {
  if (forceLocks) return run();

  const attempts = options?.attempts ?? DEFAULT_ATTEMPTS;
  const baseDelayMs = options?.baseDelayMs ?? 150;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (!isSoftTruncateContention(error) || attempt >= attempts) {
        throw error;
      }
      await sleep(baseDelayMs * attempt);
    }
  }

  throw lastError;
}
