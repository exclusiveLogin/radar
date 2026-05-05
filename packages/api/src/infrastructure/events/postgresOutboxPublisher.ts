import type { DomainEvent, IEventPublisher } from "@radar/shared";
import type { IDomainEventRepository } from "@radar/shared";

export class PostgresOutboxPublisher implements IEventPublisher {
  constructor(private readonly outbox: IDomainEventRepository) {}

  async publish(events: DomainEvent[]): Promise<void> {
    await this.outbox.append(events);
  }
}
