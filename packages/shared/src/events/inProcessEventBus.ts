/**
 * ---
 * layer: shared
 * kind: service
 * domain: events
 * tooling: in-memory bus
 * purpose: Внутрипроцессная доставка DomainEvent подписчикам.
 * ---
 */
import type { DomainEvent } from "../schemas/events/domain-event";
import type { EventHandler, IEventPublisher, IEventSubscriber, Unsubscribe } from "../ports/events";

export class InProcessEventBus implements IEventPublisher, IEventSubscriber {
  private readonly handlers = new Map<string, Set<EventHandler>>();

  subscribe(eventType: string, handler: EventHandler): Unsubscribe {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set<EventHandler>());
    }
    const set = this.handlers.get(eventType)!;
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }

  async publish(events: DomainEvent[]): Promise<void> {
    for (const event of events) {
      const exact = this.handlers.get(event.type) ?? new Set<EventHandler>();
      const wildcard = this.handlers.get("*") ?? new Set<EventHandler>();
      const all = [...exact, ...wildcard];
      for (const handler of all) {
        await handler(event);
      }
    }
  }
}
