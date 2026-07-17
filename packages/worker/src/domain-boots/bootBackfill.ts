/** Поднимает backfill зависимости только для backfill-capability. */
export async function bootBackfill<T>(wire: (module: typeof import("../application/ingest/backfillDaemonService.js")) => T): Promise<T> {
  return wire(await import("../application/ingest/backfillDaemonService.js"));
}