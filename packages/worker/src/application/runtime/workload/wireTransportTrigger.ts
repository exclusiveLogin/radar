import type {
  DomainEvent,
  IEventTransport,
  RadarTopicRoutingKey,
  TransportDelivery,
} from "@radar/shared";
import { createTriggerLayer, type TriggerLayerOptions, type TriggerContext } from "./triggerLayer.js";

export type WireTransportTriggerOptions = TriggerLayerOptions & {
  queueSuffix?: string;
  delivery?: TransportDelivery;
};

/** Debounced enqueue по transport topic — DomainEvent доезжает до gate. */
export function wireTransportTrigger(
  transport: IEventTransport,
  routingKey: RadarTopicRoutingKey,
  options: WireTransportTriggerOptions,
): () => void {
  const { queueSuffix, delivery, ...triggerOpts } = options;
  const trigger = createTriggerLayer(triggerOpts);
  const unsubscribe = transport.subscribe(
    routingKey,
    async (event: DomainEvent) => {
      const ctx: TriggerContext = {
        source: "bus",
        topic: routingKey,
        event,
      };
      trigger.fire(ctx);
    },
    queueSuffix || delivery ? { queueSuffix, delivery } : undefined,
  );
  return () => {
    unsubscribe();
    trigger.dispose();
  };
}
