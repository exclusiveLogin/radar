import type { OperationalSql } from "../phases/operationalSql.port.js";
import { listTableLockBlockers, type DbLockBlocker } from "./wipeDbLocks.js";
import { WipeTableLockError } from "./wipeTableSql.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Soft-reset: ждём освобождения AccessShare/RowExclusive на таблицах,
 * чтобы TRUNCATE не упирался в живые map-read / worker-write.
 */
export async function waitForTableLocksIdle(
  sql: OperationalSql,
  tables: string[],
  options?: { timeoutMs?: number; pollMs?: number },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 30_000;
  const pollMs = options?.pollMs ?? 250;
  const deadline = Date.now() + timeoutMs;
  let lastBlockers: DbLockBlocker[] = [];

  while (Date.now() <= deadline) {
    lastBlockers = await listTableLockBlockers(sql, tables);
    if (lastBlockers.length === 0) return;
    await sleep(pollMs);
  }

  throw new WipeTableLockError(tables, undefined, lastBlockers);
}
