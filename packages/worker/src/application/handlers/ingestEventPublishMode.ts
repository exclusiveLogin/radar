import type { DomainEvent, IEventTransport } from "@radar/shared";
import { defaultTopicForEvent } from "@radar/shared";

/** Публикует domain event через transport (RMQ / in-process). */
export async function publishDomainEventViaTransport(
  transport: IEventTransport,
  event: DomainEvent,
): Promise<void> {
  const topic = defaultTopicForEvent(event.type);
  if (!topic) return;
  await transport.publish(topic, [event]);
}

/** @deprecated — заменено transport.publish */
export type IngestEventPublisher = { transport: IEventTransport };

export async function publishIngestDomainEvent(
  publisher: IngestEventPublisher,
  event: DomainEvent,
): Promise<void> {
  await publishDomainEventViaTransport(publisher.transport, event);
}
