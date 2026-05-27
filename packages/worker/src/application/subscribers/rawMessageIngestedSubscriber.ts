import type { DomainEvent, IRawMessageRepository } from "@radar/shared";
import type { ParseRawMessageHandler } from "../handlers/parseRawMessageHandler.js";

/**
 * RawMessageIngested → загрузка raw по uuid → parse pipeline.
 * Связка агрегатов через event.aggregateId, не через ORM-граф.
 * @see ../../../../../docs/domain/how-it-works.md#ingest-flow
 * @see ../../../../../docs/domain/domain-events-and-outbox.md
 */
export function createRawMessageIngestedHandler(deps: {
  rawMessages: IRawMessageRepository;
  parseHandler: ParseRawMessageHandler;
}): (event: DomainEvent) => Promise<void> {
  return async (event: DomainEvent) => {
    if (event.type !== "RawMessageIngested") return;
    const rawMessageId = event.aggregateId;
    if (!rawMessageId) return;

    const raw = await deps.rawMessages.findById(rawMessageId);
    if (!raw) {
      console.warn(`RawMessageIngested: сообщение ${rawMessageId} не найдено.`);
      return;
    }

    await deps.parseHandler.handle(raw);
  };
}
