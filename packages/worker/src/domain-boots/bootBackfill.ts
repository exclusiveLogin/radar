import type * as backfillDaemonService from "../application/ingest/backfillDaemonService.js";

/** Поднимает backfill зависимости только для backfill-capability. */
export async function bootBackfill<T>(wire: (module: typeof backfillDaemonService) => T): Promise<T> {
  return wire(await import("../application/ingest/backfillDaemonService.js"));
}