import type { IEventTransport, RadarTopicRoutingKey } from "@radar/shared";
import { createTriggerLayer, type TriggerLayerOptions } from "./triggerLayer.js";

/** Debounced enqueue по transport topic (аналог wireBusTrigger). */
export function wireTransportTrigger(
  transport: IEventTransport,
  routingKey: RadarTopicRoutingKey,
  options: TriggerLayerOptions,
): () => void {
  const trigger = createTriggerLayer(options);
  const unsubscribe = transport.subscribe(routingKey, async () => {
    trigger.fire("bus");
  });
  return () => {
    unsubscribe();
    trigger.dispose();
  };
}