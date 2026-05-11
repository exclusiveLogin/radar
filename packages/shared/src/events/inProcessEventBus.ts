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
  private readonly handlers = new Map<string, Set<EventHandler>>();private getOrCreateHandlers(eventType: string): Set<EventHandler> {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set<EventHandler>());
    }
    return this.handlers.get(eventType)!;
  }private getHandlersForEvent(event: DomainEvent): EventHandler[] {
    const exact = this.handlers.get(event.type) ?? [];
    const wildcard = this.handlers.get("*") ?? [];
    return [...new Set([...exact, ...wildcard])];
  }subscribe(eventType: string, handler: EventHandler): Unsubscribe {
    const set = this.getOrCreateHandlers(eventType);
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }async publish(events: DomainEvent[]): Promise<void> {
    for (const event of events) {
      for (const handler of this.getHandlersForEvent(event)) {
        await handler(event);
      }
    }
  }
}
