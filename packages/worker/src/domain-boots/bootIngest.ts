import type * as ingestOrchestrator from "../application/ingest/ingestOrchestrator.js";

/** Поднимает live-ingest зависимости только для ingest-capability. */
export async function bootIngest<T>(wire: (module: typeof ingestOrchestrator) => T): Promise<T> {
  return wire(await import("../application/ingest/ingestOrchestrator.js"));
}