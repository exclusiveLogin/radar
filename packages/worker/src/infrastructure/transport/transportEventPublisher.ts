import type { DomainEvent, IEventPublisher, IEventTransport } from "@radar/shared";
import { publishDomainEventViaTransport } from "../../application/handlers/ingestEventPublishMode.js";

/** IEventPublisher поверх IEventTransport (parse handler compat). */
export class TransportEventPublisher implements IEventPublisher {
  constructor(private readonly transport: IEventTransport) {}

  async publish(events: DomainEvent[]): Promise<void> {
    for (const event of events) {
      await publishDomainEventViaTransport(this.transport, event);
    }
  }
}
