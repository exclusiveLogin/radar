import type { IRawIngestAdapter, IngestAdapterKind } from "@radar/shared";
import { ManualApiAdapter } from "./manual/manualApiAdapter.js";
import { TelegramRawIngestAdapter } from "./telegram/telegramRawIngestAdapter.js";
import type { SessionResolver } from "../../application/sessions/sessionResolver.js";

/**
 * Фабрика raw ingest адаптеров по adapterKind провайдера.
 */
export function createRawIngestAdapter(
  kind: IngestAdapterKind,
  sessionResolver: SessionResolver,
): IRawIngestAdapter {
  switch (kind) {
    case "telegram":
      return new TelegramRawIngestAdapter(sessionResolver);
    case "manual":
      return new ManualApiAdapter();
    default:
      throw new Error(`Unsupported ingest adapter kind: ${kind}`);
  }
}
