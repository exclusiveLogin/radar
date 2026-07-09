/**
 * ---
 * layer: worker/runtime
 * domain: workload
 * purpose: Trigger layer — debounce + gating перед `workload.enqueue()`. Не перегружен сложными
 *          условиями запуска на первом этапе (см. план, "Trigger layer semantics") — расширяется
 *          через `gate` policy hook, без протаскивания богатых атрибутных объектов между слоями.
 * ---
 */

import type { TriggerObsContext } from "../observability/workloadObsHooks.js";
import { reportTrigger } from "../observability/workloadObsHooks.js";

export type TriggerSource = "bus" | "scheduler" | "manual" | "cli";

export type TriggerLayerOptions = {
  /** 0/undefined — без дебаунса, триггер идёт напрямую. */
  debounceMs?: number;
  /** Гейтинг: false — триггер отбрасывается до route-to-workbook. */
  gate?: (source: TriggerSource) => boolean;
  /** route-to-workbook: обычно `workload.enqueue`. */
  onRoute: () => void;
  /** Iter 2: increment trigger counter при fire. */
  obs?: TriggerObsContext;
};

export type TriggerLayer = {
  fire: (source: TriggerSource) => void;
  dispose: () => void;
};

export function createTriggerLayer(options: TriggerLayerOptions): TriggerLayer {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    fire(source) {
      if (options.gate && !options.gate(source)) return;
      if (options.obs) reportTrigger(options.obs, source);
      if (!options.debounceMs) {
        options.onRoute();
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        options.onRoute();
      }, options.debounceMs);
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
