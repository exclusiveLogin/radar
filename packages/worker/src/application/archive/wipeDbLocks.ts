import type { OperationalSql } from "../phases/operationalSql.port.js";
import type { WipeLogger } from "./wipeLog.js";

export type DbLockBlocker = {
  pid: number;
  userName: string;
  applicationName: string;
  state: string;
  querySnippet: string;
};

/** Кто держит lock на таблицах public (кроме текущей сессии). */
export async function listTableLockBlockers(
  sql: OperationalSql,
  tables: string[],
): Promise<DbLockBlocker[]> {
  if (tables.length === 0) {
    return [];
  }

  const rows = await sql.query<DbLockBlocker>(
    `
    SELECT DISTINCT
      a.pid::int AS pid,
      a.usename AS "userName",
      COALESCE(a.application_name, '') AS "applicationName",
      a.state,
      LEFT(COALESCE(a.query, ''), 120) AS "querySnippet"
    FROM pg_locks l
    JOIN pg_stat_activity a ON a.pid = l.pid
    JOIN pg_class c ON c.oid = l.relation
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ANY($1::text[])
      AND a.pid <> pg_backend_pid()
      AND a.backend_type = 'client backend'
    ORDER BY a.pid
    `,
    [tables],
  );

  return rows;
}

function formatBlockers(blockers: DbLockBlocker[]): string {
  if (blockers.length === 0) {
    return "блокирующие сессии не найдены в pg_stat_activity (возможно idle in transaction)";
  }
  return blockers
    .map(
      (b) =>
        `pid=${b.pid} app=${b.applicationName || "?"} state=${b.state} query=${b.querySnippet || "—"}`,
    )
    .join("; ");
}

/** Завершить client-backend сессии на этих таблицах. */
export async function terminateTableLockBlockers(
  sql: OperationalSql,
  tables: string[],
  log?: WipeLogger,
): Promise<number> {
  const blockers = await listTableLockBlockers(sql, tables);
  if (blockers.length === 0) {
    log?.detail(`блокеры для [${tables.join(", ")}]: не найдены`);
    return 0;
  }

  log?.line(`блокируют TRUNCATE: ${formatBlockers(blockers)}`);

  const terminated = await sql.query<{ count: number }>(
    `
    SELECT COUNT(*)::int AS count
    FROM (
      SELECT pg_terminate_backend(a.pid)
      FROM pg_locks l
      JOIN pg_stat_activity a ON a.pid = l.pid
      JOIN pg_class c ON c.oid = l.relation
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = ANY($1::text[])
        AND a.pid <> pg_backend_pid()
        AND a.backend_type = 'client backend'
    ) t
    `,
    [tables],
  );

  const count = terminated[0]?.count ?? 0;
  log?.line(`pg_terminate_backend: ${count} сессий по таблицам [${tables.join(", ")}]`);
  return count;
}

/**
 * Закрыть все прочие client-подключения к текущей БД (dev/API/DBeaver).
 * Для system:wipe --confirm — иначе TRUNCATE parsed/events часто ждёт lock.
 */
export async function terminateOtherDatabaseBackends(
  sql: OperationalSql,
  log?: WipeLogger,
): Promise<number> {
  const preview = await sql.query<{ pid: number; applicationName: string; state: string }>(
    `
    SELECT pid::int AS pid,
           COALESCE(application_name, '') AS "applicationName",
           state
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
      AND backend_type = 'client backend'
    ORDER BY pid
    `,
  );

  if (preview.length === 0) {
    log?.detail("других подключений к БД нет");
    return 0;
  }

  log?.line(
    `закрываем прочие подключения к БД (${preview.length}): ` +
      preview
        .map((s) => `pid=${s.pid} app=${s.applicationName || "?"} state=${s.state}`)
        .join("; "),
  );

  const terminated = await sql.query<{ count: number }>(
    `
    SELECT COUNT(*)::int AS count
    FROM (
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND backend_type = 'client backend'
    ) t
    `,
  );

  const count = terminated[0]?.count ?? 0;
  log?.line(`pg_terminate_backend: закрыто ${count} подключений`);
  return count;
}

export function formatBlockersForError(
  tables: string[],
  blockers: DbLockBlocker[],
): string {
  return (
    `TRUNCATE заблокирован (${tables.join(", ")}). ` +
    `Блокеры: ${formatBlockers(blockers)}. ` +
    `Остановите npm run dev / API или повторите без --no-force-locks.`
  );
}
