import type {
  IRawIngestAdapter,
  IngestAdapterContext,
  IngestAdapterHealth,
  IngestBindingRecord,
  IngestMessageSink,
} from "@radar/shared";

/**
 * Manual ingest: сообщения приходят через admin API POST, live duty loop не нужен.
 */
export class ManualApiAdapter implements IRawIngestAdapter {
  readonly kind = "manual" as const;

  async connect(_ctx: IngestAdapterContext): Promise<void> {
    // Нет внешнего transport — только API write-side.
  }

  async startDuty(
    _bindings: IngestBindingRecord[],
    _sink: IngestMessageSink,
  ): Promise<void> {
    // Без long-poll / webhook server на этой итерации.
  }

  async stop(): Promise<void> {}

  async health(): Promise<IngestAdapterHealth> {
    return { ok: true, detail: "manual_api_passive" };
  }
}
