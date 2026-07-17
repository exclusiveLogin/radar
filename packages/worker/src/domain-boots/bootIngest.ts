/** Поднимает live-ingest зависимости только для ingest-capability. */
export async function bootIngest<T>(wire: (module: typeof import("../application/ingest/ingestOrchestrator.js")) => T): Promise<T> {
  return wire(await import("../application/ingest/ingestOrchestrator.js"));
}