/**
 * ---
 * layer: worker/runtime
 * domain: workload
 * purpose: Wave 6 (tracking-parse-architecture-refactor) — ingest chaining как хореография по
 *          сигналам вместо централизованной оркестрации: тонкий адаптер bus-событие → TriggerLayer
 *          → `workload.enqueue()`. Каждый context (parse/tracking/geo-enrich) сам решает, реагировать
 *          ли на апстрим-событие — эта функция только подключает провод, знание "что" и "зачем"
 *          остаётся у вызывающей стороны (composition root).
 * ---
 */
import type { IEventSubscriber } from "@radar/shared";
import { createTriggerLayer, type TriggerLayerOptions } from "./triggerLayer.js";

export function wireBusTrigger(
  bus: IEventSubscriber,
  eventType: string,
  options: TriggerLayerOptions,
): () => void {
  const trigger = createTriggerLayer(options);
  const unsubscribe = bus.subscribe(eventType, async () => {
    trigger.fire("bus");
  });
  return () => {
    unsubscribe();
    trigger.dispose();
  };
}
