import type { DomainEvent, IDomainEventRepository, IEventPublisher } from "@radar/shared";

export type IngestEventPublisher =
  | { mode: "bus"; bus: IEventPublisher }
  | { mode: "outbox"; outbox: IDomainEventRepository }
  | { mode: "both"; bus: IEventPublisher; outbox: IDomainEventRepository };

/** Публикует доменное событие ingest согласно роли worker. */
export async function publishIngestDomainEvent(
  publisher: IngestEventPublisher,
  event: DomainEvent,
): Promise<void> {
  if (publisher.mode === "bus" || publisher.mode === "both") {
    await publisher.bus.publish([event]);
  }
  if (publisher.mode === "outbox" || publisher.mode === "both") {
    await publisher.outbox.append([event]);
  }
}
