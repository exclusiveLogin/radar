import type { DataSource } from "typeorm";
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
  dataSource: DataSource,
  options: { includeDomainEvents?: boolean; log?: WipeLogger } = {},
): Promise<ClearIngestOperationalStateResult> {
  const { log } = options;

  const backfillJobsDeleted = await truncateTableCounted(
    dataSource,
    "job_ingest_backfill",
    { log },
  );
  const cursorsDeleted = await truncateTableCounted(dataSource, "state_ingest_cursor", { log });

  const providersWithErrors = (await dataSource.query(
    `SELECT COUNT(*)::int AS count FROM ingest_providers WHERE last_error IS NOT NULL`,
  )) as Array<{ count: number }>;
  log?.detail(
    `очистка ingest_providers.last_error (${providersWithErrors[0]?.count ?? 0} строк)`,
  );
  await dataSource.query(
    `UPDATE ingest_providers SET last_error = NULL, updated_at = now()
     WHERE last_error IS NOT NULL`,
  );

  let domainEventsDeleted = 0;
  if (options.includeDomainEvents !== false) {
    domainEventsDeleted = await truncateTableCounted(dataSource, "event_outbox", { log });
  }

  return {
    backfillJobsCanceled: 0,
    backfillJobsDeleted,
    cursorsDeleted,
    providersErrorsCleared: providersWithErrors[0]?.count ?? 0,
    domainEventsDeleted,
  };
}
