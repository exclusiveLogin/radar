/** PostgreSQL deadlock (serialization failure). */
export const PG_DEADLOCK_CODE = "40P01";
/** lock_timeout / pg_try_advisory_lock miss. */
export const PG_LOCK_NOT_AVAILABLE_CODE = "55P03";
/** statement_timeout / query_canceled. */
export const PG_STATEMENT_TIMEOUT_CODE = "57014";

function readPgCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const direct = (error as { code?: string }).code;
  if (direct) return direct;
  return (error as { driverError?: { code?: string } }).driverError?.code;
}

/** PostgreSQL deadlock (serialization failure). */
export function isPgDeadlockError(error: unknown): boolean {
  return readPgCode(error) === PG_DEADLOCK_CODE;
}

/** PostgreSQL lock_timeout (advisory / relation). */
export function isPgLockNotAvailableError(error: unknown): boolean {
  return readPgCode(error) === PG_LOCK_NOT_AVAILABLE_CODE;
}

/** Запрос отменён statement_timeout (часто lock wait во время bulk write). */
export function isPgStatementTimeoutError(error: unknown): boolean {
  return readPgCode(error) === PG_STATEMENT_TIMEOUT_CODE;
}

/** Read-path: deadlock или timeout — безопасно повторить. */
export function isPgContendedReadError(error: unknown): boolean {
  const code = readPgCode(error);
  return code === PG_DEADLOCK_CODE || code === PG_STATEMENT_TIMEOUT_CODE;
}

function readPgMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const direct = (error as { message?: string }).message;
  if (direct) return direct;
  return (error as { driverError?: { message?: string } }).driverError?.message ?? "";
}

/** lock_timeout (55P03 или 57014 с текстом «lock timeout»). */
export function isPgLockTimeoutError(error: unknown): boolean {
  if (isPgLockNotAvailableError(error)) return true;
  if (!isPgStatementTimeoutError(error)) return false;
  return /lock timeout/i.test(readPgMessage(error));
}

/** TRUNCATE / advisory xact_lock при reset rebuild. */
export function isPgContendedL1ResetError(error: unknown): boolean {
  return (
    isPgDeadlockError(error)
    || isPgLockTimeoutError(error)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Повтор read при deadlock/timeout (worker пишет event_locations параллельно fold).
 * Write-path не оборачивать.
 */
export async function withPgDeadlockRetry<T>(
  fn: () => Promise<T>,
  options?: { maxAttempts?: number; baseDelayMs?: number },
): Promise<T> {
  return withPgContendedReadRetry(fn, options);
}

export async function withPgContendedReadRetry<T>(
  fn: () => Promise<T>,
  options?: { maxAttempts?: number; baseDelayMs?: number },
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 5;
  const baseDelayMs = options?.baseDelayMs ?? 80;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isPgContendedReadError(error) || attempt >= maxAttempts) {
        throw error;
      }
      await sleep(baseDelayMs * attempt + Math.random() * baseDelayMs);
    }
  }

  throw lastError;
}
