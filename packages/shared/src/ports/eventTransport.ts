import type { DomainEvent } from "../schemas/events/domain-event.js";
import type { RadarTopicRoutingKey } from "../transport/topicCatalog.js";
import type { Unsubscribe } from "./events.js";

export type TransportEventHandler = (event: DomainEvent) => Promise<void>;
export type TransportSignalHandler = (payload: Record<string, unknown>) => Promise<void>;

/** Опции subscribe; RMQ использует queueSuffix для fan-out per role. */
export type TransportSubscribeOptions = {
  queueSuffix?: string;
};

/** Единый порт планирования: RMQ / in-process. */
export interface IEventTransport {
  publish(routingKey: RadarTopicRoutingKey, events: DomainEvent[]): Promise<void>;
  publishSignal(routingKey: RadarTopicRoutingKey, payload: Record<string, unknown>): Promise<void>;
  subscribe(
    routingKey: RadarTopicRoutingKey,
    handler: TransportEventHandler,
    options?: TransportSubscribeOptions,
  ): Unsubscribe;
  subscribeSignal(
    routingKey: RadarTopicRoutingKey,
    handler: TransportSignalHandler,
    options?: TransportSubscribeOptions,
  ): Unsubscribe;
  start(): Promise<void>;
  stop(): Promise<void>;
}
