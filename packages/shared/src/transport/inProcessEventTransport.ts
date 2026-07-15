import type { DomainEvent } from "../schemas/events/domain-event.js";
import type {
  IEventTransport,
  TransportEventHandler,
  TransportSignalHandler,
  TransportSubscribeOptions,
} from "../ports/eventTransport.js";
import type { Unsubscribe } from "../ports/events.js";
import type { RadarTopicRoutingKey } from "./topicCatalog.js";

/** In-process transport — sync Map, те же routing keys. */
export class InProcessEventTransport implements IEventTransport {
  private readonly eventHandlers = new Map<RadarTopicRoutingKey, Set<TransportEventHandler>>();
  private readonly signalHandlers = new Map<RadarTopicRoutingKey, Set<TransportSignalHandler>>();

  async start(): Promise<void> {}
  async stop(): Promise<void> {
    this.eventHandlers.clear();
    this.signalHandlers.clear();
  }

  subscribe(
    routingKey: RadarTopicRoutingKey,
    handler: TransportEventHandler,
    _options?: TransportSubscribeOptions,
  ): Unsubscribe {
    const set = this.getOrCreate(this.eventHandlers, routingKey);
    set.add(handler);
    return () => set.delete(handler);
  }

  subscribeSignal(
    routingKey: RadarTopicRoutingKey,
    handler: TransportSignalHandler,
    _options?: TransportSubscribeOptions,
  ): Unsubscribe {
    const set = this.getOrCreate(this.signalHandlers, routingKey);
    set.add(handler);
    return () => set.delete(handler);
  }

  async publish(routingKey: RadarTopicRoutingKey, events: DomainEvent[]): Promise<void> {
    const handlers = [...(this.eventHandlers.get(routingKey) ?? [])];
    for (const event of events) {
      for (const handler of handlers) await handler(event);
    }
  }

  async publishSignal(routingKey: RadarTopicRoutingKey, payload: Record<string, unknown>): Promise<void> {
    const handlers = [...(this.signalHandlers.get(routingKey) ?? [])];
    for (const handler of handlers) await handler(payload);
  }

  private getOrCreate<T>(map: Map<RadarTopicRoutingKey, Set<T>>, key: RadarTopicRoutingKey): Set<T> {
    if (!map.has(key)) map.set(key, new Set<T>());
    return map.get(key)!;
  }
}
