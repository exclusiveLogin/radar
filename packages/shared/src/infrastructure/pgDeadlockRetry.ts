/** PostgreSQL deadlock. */
const PG_DEADLOCK_CODE = "40P01";
/** statement_timeout / query_canceled. */
const PG_STATEMENT_TIMEOUT_CODE = "57014";

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

/** Запрос отменён statement_timeout (часто lock wait во время bulk write). */
export function isPgStatementTimeoutError(error: unknown): boolean {
  return readPgCode(error) === PG_STATEMENT_TIMEOUT_CODE;
}

/** Read-path: deadlock или timeout — безопасно повторить. */
export function isPgContendedReadError(error: unknown): boolean {
  const code = readPgCode(error);
  return code === PG_DEADLOCK_CODE || code === PG_STATEMENT_TIMEOUT_CODE;
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
