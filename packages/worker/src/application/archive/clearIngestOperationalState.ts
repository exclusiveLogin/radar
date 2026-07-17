import type { OperationalSql } from "../phases/operationalSql.port.js";
import type { WipeLogger } from "./wipeLog.js";
import { truncateTableCounted } from "./wipeTableSql.js";

export const CLEAR_INGEST_REASON = "clear:ingest";

export type ClearIngestOperationalStateResult = {
  backfillJobsCanceled: number;
  backfillJobsDeleted: number;
  cursorsDeleted: number;
  providersErrorsCleared: number;
  domainEventsDeleted: number;
};

/**
 * Сброс операционного состояния ingest: курсоры, backfill-джобы, ошибки провайдеров.
 */
export async function clearIngestOperationalState(
  sql: OperationalSql,
  options: { includeDomainEvents?: boolean; log?: WipeLogger } = {},
): Promise<ClearIngestOperationalStateResult> {
  const { log } = options;

  const backfillJobsDeleted = await truncateTableCounted(
    sql,
    "job_ingest_backfill",
    { log },
  );
  const cursorsDeleted = await truncateTableCounted(sql, "state_ingest_cursor", { log });

  const providersWithErrors = await sql.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM ingest_providers WHERE last_error IS NOT NULL`,
  );
  log?.detail(
    `очистка ingest_providers.last_error (${providersWithErrors[0]?.count ?? 0} строк)`,
  );
  await sql.query(
    `UPDATE ingest_providers SET last_error = NULL, updated_at = now()
     WHERE last_error IS NOT NULL`,
  );

  let domainEventsDeleted = 0;
  if (options.includeDomainEvents !== false) {
    domainEventsDeleted = await truncateTableCounted(sql, "event_outbox", { log });
  }

  return {
    backfillJobsCanceled: 0,
    backfillJobsDeleted,
    cursorsDeleted,
    providersErrorsCleared: providersWithErrors[0]?.count ?? 0,
    domainEventsDeleted,
  };
}
