import type { OperationalSql } from "../phases/operationalSql.port.js";
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
  const details = collectDatabaseErrors(error);
  return details.some(
    ({ code, message }) =>
      code === "55P03" ||
      (code === "57014" && message.includes("due to lock timeout")),
  );
}

type DatabaseErrorDetails = {
  code?: string;
  message: string;
};

/** Достаёт PostgreSQL error из TypeORM-обёрток transaction / driverError / cause. */
function collectDatabaseErrors(error: unknown): DatabaseErrorDetails[] {
  if (typeof error !== "object" || error === null) return [];

  const candidate = error as {
    code?: unknown;
    message?: unknown;
    driverError?: unknown;
    cause?: unknown;
  };
  const current = {
    code: typeof candidate.code === "string" ? candidate.code : undefined,
    message: typeof candidate.message === "string" ? candidate.message : "",
  };

  return [
    current,
    ...collectDatabaseErrors(candidate.driverError),
    ...collectDatabaseErrors(candidate.cause),
  ];
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
            `Остановите npm run dev / API или повторите без --no-force-locks.`,
    );
    this.name = "WipeTableLockError";
    if (cause instanceof Error) {
      this.cause = cause;
    }
  }
}

async function withWipeSession<T>(
  sql: OperationalSql,
  lockTimeoutMs: number,
  log: WipeLogger | undefined,
  run: (transaction: OperationalSql) => Promise<T>,
): Promise<T> {
  log?.detail(`транзакция: lock_timeout=${lockTimeoutMs}ms, ожидание блокировки…`);
  try {
    return await sql.transaction(async (transaction) => {
      await transaction.query(`SET LOCAL lock_timeout = '${lockTimeoutMs}ms'`);
      await transaction.query(
        `SET LOCAL statement_timeout = '${Math.max(lockTimeoutMs * 4, 120_000)}ms'`,
      );
      return run(transaction);
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
  sql: OperationalSql,
  table: string,
): Promise<boolean> {
  const rows = await sql.query<{ exists: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [`public.${table}`],
  );
  return rows[0]?.exists ?? false;
}

/** COUNT(*) до wipe. */
export async function countTableRows(
  sql: OperationalSql,
  table: string,
  log?: WipeLogger,
): Promise<number> {
  if (!(await tableExists(sql, table))) {
    log?.detail(`COUNT ${table}: таблица отсутствует → 0`);
    return 0;
  }
  log?.detail(`COUNT ${table}…`);
  const rows = await withWipeSession(
    sql,
    DEFAULT_LOCK_TIMEOUT_MS,
    log,
    (transaction) =>
      transaction.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM ${quoteTable(table)}`),
  );
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
  sqlExecutor: OperationalSql,
  sql: string,
  lockTimeoutMs: number,
  log: WipeLogger | undefined,
): Promise<void> {
  await withWipeSession(sqlExecutor, lockTimeoutMs, log, async (transaction) => {
    await transaction.query(sql);
  });
}

/** TRUNCATE одной или нескольких таблиц; CASCADE снимает зависимые FK. */
export async function truncateTables(
  sqlExecutor: OperationalSql,
  tables: string[],
  options: TruncateOptions = {},
): Promise<void> {
  const { log } = options;
  const existing: string[] = [];
  const missing: string[] = [];

  for (const table of tables) {
    if (await tableExists(sqlExecutor, table)) {
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
    await runTruncateSql(sqlExecutor, sql, lockTimeoutMs, log);
    log?.detail(`TRUNCATE ok: ${existing.join(", ")}`);
  } catch (error) {
    if (error instanceof WipeTableLockError && options.forceLocks) {
      log?.line("lock timeout — снимаем блокировки и повторяем TRUNCATE…");
      await terminateTableLockBlockers(sqlExecutor, existing, log);
      try {
        await runTruncateSql(sqlExecutor, sql, lockTimeoutMs, log);
        log?.detail(`TRUNCATE ok (retry): ${existing.join(", ")}`);
        return;
      } catch (retryError) {
        const blockers = await listTableLockBlockers(sqlExecutor, existing);
        throw new WipeTableLockError(existing, retryError, blockers);
      }
    }
    if (error instanceof WipeTableLockError) {
      const blockers = await listTableLockBlockers(sqlExecutor, existing);
      throw new WipeTableLockError(existing, error.cause, blockers);
    }
    throw error;
  }
}

/** TRUNCATE с опциональным COUNT до очистки. */
export async function truncateTablesCounted(
  sql: OperationalSql,
  tables: string[],
  options: TruncateOptions = {},
): Promise<number> {
  let total = 0;
  if (options.countBefore) {
    for (const table of tables) {
      total += await countTableRows(sql, table, options.log);
    }
  }
  await truncateTables(sql, tables, options);
  return total;
}

/** @deprecated используй truncateTablesCounted */
export async function truncateGroupCounted(
  sql: OperationalSql,
  tables: string[],
  options: TruncateOptions = {},
): Promise<number> {
  return truncateTablesCounted(sql, tables, options);
}

/** TRUNCATE одной таблицы. */
export async function truncateTableCounted(
  sql: OperationalSql,
  table: string,
  options: TruncateOptions = {},
): Promise<number> {
  return truncateTablesCounted(sql, [table], options);
}

/** UPDATE без RETURNING; ошибки глотаем (опциональные колонки/таблицы). */
export async function runSqlOptional(
  sqlExecutor: OperationalSql,
  sql: string,
  log?: WipeLogger,
): Promise<void> {
  log?.detail("UPDATE (unlink FK)…");
  log?.sql(sql.trim().replace(/\s+/g, " "));
  try {
    await withWipeSession(sqlExecutor, DEFAULT_LOCK_TIMEOUT_MS, log, (transaction) =>
      transaction.query(sql),
    );
    log?.detail("UPDATE ok");
  } catch (error) {
    if (error instanceof WipeTableLockError) {
      throw error;
    }
    log?.detail("UPDATE пропущен (таблица/колонка может отсутствовать)");
  }
}
