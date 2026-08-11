import type { DomainEvent, IEventSubscriber } from "@radar/shared";
import { createTriggerLayer, type TriggerLayerOptions, type TriggerContext } from "./triggerLayer.js";

/** Debounced enqueue по in-process bus event type (DomainEvent сохраняется). */
export function wireBusTrigger(
  bus: IEventSubscriber,
  eventType: string,
  options: TriggerLayerOptions,
): () => void {
  const trigger = createTriggerLayer(options);
  const unsubscribe = bus.subscribe(eventType, async (event: DomainEvent) => {
    const ctx: TriggerContext = {
      source: "bus",
      topic: eventType,
      event,
    };
    trigger.fire(ctx);
  });
  return () => {
    unsubscribe();
    trigger.dispose();
  };
}
