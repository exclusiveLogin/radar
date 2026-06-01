import type { DataSource } from "typeorm";

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
 * Конфиг (channels, providers, bindings) не удаляется.
 */
export async function clearIngestOperationalState(
  dataSource: DataSource,
  options: { includeDomainEvents?: boolean } = {},
): Promise<ClearIngestOperationalStateResult> {
  const canceledRows = (await dataSource.query(
    `UPDATE ingest_backfill_jobs SET status = 'canceled', updated_at = now()
     WHERE status IN ('pending', 'running')
     RETURNING id`,
  )) as Array<{ id: string }>;

  const deletedJobs = (await dataSource.query(
    `DELETE FROM ingest_backfill_jobs RETURNING id`,
  )) as Array<{ id: string }>;

  const deletedCursors = (await dataSource.query(
    `DELETE FROM ingest_cursors RETURNING channel_id`,
  )) as Array<{ channel_id: string }>;

  const clearedProviders = (await dataSource.query(
    `UPDATE ingest_providers SET last_error = NULL, updated_at = now()
     WHERE last_error IS NOT NULL
     RETURNING id`,
  )) as Array<{ id: string }>;

  let domainEventsDeleted = 0;
  if (options.includeDomainEvents !== false) {
    const eventRows = (await dataSource.query(
      `DELETE FROM domain_events
       WHERE aggregate_type IN ('ingest_provider', 'ingest_binding', 'raw_message')
       RETURNING id`,
    )) as Array<{ id: string }>;
    domainEventsDeleted = eventRows.length;
  }

  return {
    backfillJobsCanceled: canceledRows.length,
    backfillJobsDeleted: deletedJobs.length,
    cursorsDeleted: deletedCursors.length,
    providersErrorsCleared: clearedProviders.length,
    domainEventsDeleted,
  };
}
