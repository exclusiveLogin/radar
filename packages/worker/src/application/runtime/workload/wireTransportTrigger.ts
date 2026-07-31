import type {
  IEventTransport,
  RadarTopicRoutingKey,
  TransportDelivery,
} from "@radar/shared";
import { createTriggerLayer, type TriggerLayerOptions } from "./triggerLayer.js";

export type WireTransportTriggerOptions = TriggerLayerOptions & {
  /** RMQ fan-out queue suffix (parse/geo/tracking). */
  queueSuffix?: string;
  /** Безадресный wake не требует хранения и повторной доставки. */
  delivery?: TransportDelivery;
};

/** Debounced enqueue по transport topic (аналог wireBusTrigger). */
export function wireTransportTrigger(
  transport: IEventTransport,
  routingKey: RadarTopicRoutingKey,
  options: WireTransportTriggerOptions,
): () => void {
  const { queueSuffix, delivery, ...triggerOpts } = options;
  const trigger = createTriggerLayer(triggerOpts);
  const unsubscribe = transport.subscribe(
    routingKey,
    async () => {
      trigger.fire("bus");
    },
    queueSuffix || delivery ? { queueSuffix, delivery } : undefined,
  );
  return () => {
    unsubscribe();
    trigger.dispose();
  };
}
