import type {
  DomainEvent,
  EnrichStage,
  EventHandler,
  IEnrichmentQueueRepository,
} from "@radar/shared";

type MessageParsedPayload = {
  rawMessageId?: string;
};

/**
 * Ставит задачи фонового обогащения на каждый MessageParsed — по одной на
 * каждый включённый lazy-stage (политика из `phase_definitions`, ADR-003).
 *
 * Enqueue идемпотентен (ON CONFLICT(raw_message_id, stage) DO NOTHING): ре-эмит
 * MessageParsed из stage-ранера не плодит дубли и не сбрасывает done-задачи —
 * это и есть защита от петли ре-энкью.
 */
export function createEnrichmentEnqueueHandler(
  queue: IEnrichmentQueueRepository,
  getEnabledStages: () => Promise<EnrichStage[]>,
): EventHandler {
  return async (event: DomainEvent): Promise<void> => {
    if (event.type !== "MessageParsed") return;
    const payload = event.payload as MessageParsedPayload;
    if (!payload.rawMessageId) return;

    const stages = await getEnabledStages();
    for (const stage of stages) {
      await queue.enqueue({
        rawMessageId: payload.rawMessageId,
        stage,
        parsedEventId: event.aggregateId,
      });
    }
  };
}
