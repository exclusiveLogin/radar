import type {
  DomainEvent,
  EventHandler,
  IEnrichmentQueueRepository,
} from "@radar/shared";

type MessageParsedPayload = {
  rawMessageId?: string;
};

/**
 * Ставит задачу фонового обогащения на каждый MessageParsed.
 * Enqueue идемпотентен (ON CONFLICT(raw_message_id) DO NOTHING), поэтому
 * ре-эмит MessageParsed из фонового потребителя не плодит дубли задач.
 */
export function createEnrichmentEnqueueHandler(
  queue: IEnrichmentQueueRepository,
): EventHandler {
  return async (event: DomainEvent): Promise<void> => {
    if (event.type !== "MessageParsed") return;
    const payload = event.payload as MessageParsedPayload;
    if (!payload.rawMessageId) return;
    await queue.enqueue({
      rawMessageId: payload.rawMessageId,
      parsedEventId: event.aggregateId,
    });
  };
}
