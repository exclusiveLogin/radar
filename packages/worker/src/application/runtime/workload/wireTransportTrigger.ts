import type { IEventTransport, RadarTopicRoutingKey } from "@radar/shared";
import { createTriggerLayer, type TriggerLayerOptions } from "./triggerLayer.js";

export type WireTransportTriggerOptions = TriggerLayerOptions & {
  /** RMQ fan-out queue suffix (parse/geo/tracking). */
  queueSuffix?: string;
};

/** Debounced enqueue по transport topic (аналог wireBusTrigger). */
export function wireTransportTrigger(
  transport: IEventTransport,
  routingKey: RadarTopicRoutingKey,
  options: WireTransportTriggerOptions,
): () => void {
  const { queueSuffix, ...triggerOpts } = options;
  const trigger = createTriggerLayer(triggerOpts);
  const unsubscribe = transport.subscribe(
    routingKey,
    async () => {
      trigger.fire("bus");
    },
    queueSuffix ? { queueSuffix } : undefined,
  );
  return () => {
    unsubscribe();
    trigger.dispose();
  };
}
