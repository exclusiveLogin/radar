import type { DomainEvent } from "../schemas/events/domain-event";

export type EventHandler = (event: DomainEvent) => Promise<void>;
export type Unsubscribe = () => void;

export interface IEventPublisher {
  publish(events: DomainEvent[]): Promise<void>;
}

export interface IEventSubscriber {
  subscribe(eventType: string, handler: EventHandler): Unsubscribe;
}
