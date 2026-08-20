/**
 * ---
 * layer: worker/infrastructure
 * domain: events
 * purpose: Внутрипроцессная доставка DomainEvent подписчикам worker.
 * ---
 */
import type {
  DomainEvent,
  EventHandler,
  IEventPublisher,
  IEventSubscriber,
  Unsubscribe,
} from "@radar/shared";

/** Локальный runtime-adapter для подписок worker на доменные события. */
export class InProcessEventBus implements IEventPublisher, IEventSubscriber {
  private readonly handlers = new Map<string, Set<EventHandler>>();

  subscribe(eventType: string, handler: EventHandler): Unsubscribe {
    const handlers = this.getOrCreateHandlers(eventType);
    handlers.add(handler);
    return () => handlers.delete(handler);
  }

  async publish(events: DomainEvent[]): Promise<void> {
    for (const event of events) {
      for (const handler of this.getHandlersForEvent(event)) {
        await handler(event);
      }
    }
  }

  private getOrCreateHandlers(eventType: string): Set<EventHandler> {
    const handlers = this.handlers.get(eventType) ?? new Set<EventHandler>();
    this.handlers.set(eventType, handlers);
    return handlers;
  }

  private getHandlersForEvent(event: DomainEvent): EventHandler[] {
    const exact = this.handlers.get(event.type) ?? [];
    const wildcard = this.handlers.get("*") ?? [];
    return [...new Set([...exact, ...wildcard])];
  }
}
