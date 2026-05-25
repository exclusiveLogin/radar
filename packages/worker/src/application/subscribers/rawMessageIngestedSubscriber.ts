import type { DomainEvent, IRawMessageRepository } from "@radar/shared";
import type { ParseRawMessageHandler } from "../handlers/parseRawMessageHandler.js";

/**
 * RawMessageIngested → загрузка raw по uuid → parse pipeline.
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
