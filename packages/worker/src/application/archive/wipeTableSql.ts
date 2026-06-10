import type { DataSource, EntityManager } from "typeorm";
import type { WipeLogger } from "./wipeLog.js";
import {
  formatBlockersForError,
  listTableLockBlockers,
  terminateTableLockBlockers,
} from "./wipeDbLocks.js";

const TABLE_NAME = /^[a-z][a-z0-9_]*$/;
const DEFAULT_LOCK_TIMEOUT_MS = 30_000;

function quoteTable(name: string): string {
  if (!TABLE_NAME.test(name)) {
    throw new Error(`Недопустимое имя таблицы: ${name}`);
  }
  return `"${name}"`;
}

function isLockTimeoutError(error: unknown): boolean {
  const code =
    typeof error === "object" &&
    error !== null &&
    "driverError" in error &&
    typeof (error as { driverError?: { code?: string } }).driverError?.code === "string"
      ? (error as { driverError: { code: string } }).driverError.code
      : undefined;
  return code === "55P03";
}

/** Таблица занята другим процессом (dev/API). */
export class WipeTableLockError extends Error {
  constructor(
    public readonly tables: string[],
    cause?: unknown,
    blockers?: Awaited<ReturnType<typeof listTableLockBlockers>>,
  ) {
    super(
      blockers && blockers.length > 0
        ? formatBlockersForError(tables, blockers)
        : `TRUNCATE заблокирован (${tables.join(", ")}). ` +
            `Остановите npm run dev / API и повторите system:wipe.`,
    );
    this.name = "WipeTableLockError";
    if (cause instanceof Error) {
      this.cause = cause;
    }
  }
}

async function withWipeSession<T>(
  dataSource: DataSource,
  lockTimeoutMs: number,
  log: WipeLogger | undefined,
  run: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  log?.detail(`транзакция: lock_timeout=${lockTimeoutMs}ms, ожидание блокировки…`);
  try {
    return await dataSource.transaction(async (manager) => {
      await manager.query(`SET LOCAL lock_timeout = '${lockTimeoutMs}ms'`);
      await manager.query(
        `SET LOCAL statement_timeout = '${Math.max(lockTimeoutMs * 4, 120_000)}ms'`,
      );
      return run(manager);
    });
  } catch (error) {
    if (isLockTimeoutError(error)) {
      throw new WipeTableLockError([], error);
    }
    throw error;
  }
}

/** Есть ли таблица в public (стенд без полного migration:run). */
export async function tableExists(
  dataSource: DataSource,
  table: string,
): Promise<boolean> {
  const rows = (await dataSource.query(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [`public.${table}`],
  )) as Array<{ exists: boolean }>;
  return rows[0]?.exists ?? false;
}

/** COUNT(*) до wipe. */
export async function countTableRows(
  dataSource: DataSource,
  table: string,
  log?: WipeLogger,
): Promise<number> {
  if (!(await tableExists(dataSource, table))) {
    log?.detail(`COUNT ${table}: таблица отсутствует → 0`);
    return 0;
  }
  log?.detail(`COUNT ${table}…`);
  const rows = (await withWipeSession(
    dataSource,
    DEFAULT_LOCK_TIMEOUT_MS,
    log,
    (manager) => manager.query(`SELECT COUNT(*)::int AS count FROM ${quoteTable(table)}`),
  )) as Array<{ count: number }>;
  const count = rows[0]?.count ?? 0;
  log?.detail(`COUNT ${table} = ${count}`);
  return count;
}

export type TruncateOptions = {
  cascade?: boolean;
  lockTimeoutMs?: number;
  countBefore?: boolean;
  log?: WipeLogger;
  /** После lock timeout — terminate blockers и повторить TRUNCATE. */
  forceLocks?: boolean;
};

async function runTruncateSql(
  dataSource: DataSource,
  sql: string,
  lockTimeoutMs: number,
  log: WipeLogger | undefined,
): Promise<void> {
  await withWipeSession(dataSource, lockTimeoutMs, log, async (manager) => {
    await manager.query(sql);
  });
}

/** TRUNCATE одной или нескольких таблиц; CASCADE снимает зависимые FK. */
export async function truncateTables(
  dataSource: DataSource,
  tables: string[],
  options: TruncateOptions = {},
): Promise<void> {
  const { log } = options;
  const existing: string[] = [];
  const missing: string[] = [];

  for (const table of tables) {
    if (await tableExists(dataSource, table)) {
      existing.push(table);
    } else {
      missing.push(table);
    }
  }

  if (missing.length > 0) {
    log?.detail(`пропуск (нет в БД): ${missing.join(", ")}`);
  }
  if (existing.length === 0) {
    log?.detail("TRUNCATE: нечего очищать");
    return;
  }

  const lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const cascade = options.cascade !== false ? " CASCADE" : "";
  const sql = `TRUNCATE TABLE ${existing.map(quoteTable).join(", ")}${cascade}`;

  log?.detail(`TRUNCATE ${existing.join(", ")}${cascade ? " CASCADE" : ""}…`);
  log?.sql(sql);

  try {
    await runTruncateSql(dataSource, sql, lockTimeoutMs, log);
    log?.detail(`TRUNCATE ok: ${existing.join(", ")}`);
  } catch (error) {
    if (error instanceof WipeTableLockError && options.forceLocks) {
      log?.line("lock timeout — снимаем блокировки и повторяем TRUNCATE…");
      await terminateTableLockBlockers(dataSource, existing, log);
      try {
        await runTruncateSql(dataSource, sql, lockTimeoutMs, log);
        log?.detail(`TRUNCATE ok (retry): ${existing.join(", ")}`);
        return;
      } catch (retryError) {
        const blockers = await listTableLockBlockers(dataSource, existing);
        throw new WipeTableLockError(existing, retryError, blockers);
      }
    }
    if (error instanceof WipeTableLockError) {
      const blockers = await listTableLockBlockers(dataSource, existing);
      throw new WipeTableLockError(existing, error.cause, blockers);
    }
    throw error;
  }
}

/** TRUNCATE с опциональным COUNT до очистки. */
export async function truncateTablesCounted(
  dataSource: DataSource,
  tables: string[],
  options: TruncateOptions = {},
): Promise<number> {
  let total = 0;
  if (options.countBefore) {
    for (const table of tables) {
      total += await countTableRows(dataSource, table, options.log);
    }
  }
  await truncateTables(dataSource, tables, options);
  return total;
}

/** @deprecated используй truncateTablesCounted */
export async function truncateGroupCounted(
  dataSource: DataSource,
  tables: string[],
  options: TruncateOptions = {},
): Promise<number> {
  return truncateTablesCounted(dataSource, tables, options);
}

/** TRUNCATE одной таблицы. */
export async function truncateTableCounted(
  dataSource: DataSource,
  table: string,
  options: TruncateOptions = {},
): Promise<number> {
  return truncateTablesCounted(dataSource, [table], options);
}

/** UPDATE без RETURNING; ошибки глотаем (опциональные колонки/таблицы). */
export async function runSqlOptional(
  dataSource: DataSource,
  sql: string,
  log?: WipeLogger,
): Promise<void> {
  log?.detail("UPDATE (unlink FK)…");
  log?.sql(sql.trim().replace(/\s+/g, " "));
  try {
    await withWipeSession(dataSource, DEFAULT_LOCK_TIMEOUT_MS, log, (manager) =>
      manager.query(sql),
    );
    log?.detail("UPDATE ok");
  } catch (error) {
    if (error instanceof WipeTableLockError) {
      throw error;
    }
    log?.detail("UPDATE пропущен (таблица/колонка может отсутствовать)");
  }
}
