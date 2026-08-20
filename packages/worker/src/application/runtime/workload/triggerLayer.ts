/**
 * ---
 * layer: worker/runtime
 * domain: workload
 * purpose: Trigger layer — debounce + gating перед route. Контекст несёт DomainEvent.
 * ---
 */
import type { DomainEvent } from "@radar/shared";
import type { TriggerObsContext } from "../observability/workloadObsHooks.js";
import { reportTrigger } from "../observability/workloadObsHooks.js";

export type TriggerSource = "bus" | "scheduler" | "manual" | "cli" | "system";

export type TriggerContext = {
  source: TriggerSource;
  topic?: string;
  event?: DomainEvent;
  ids?: string[];
};

export type TriggerLayerOptions = {
  debounceMs?: number;
  gate?: (ctx: TriggerContext) => boolean;
  /** Вызывается после debounce с накопленным контекстом (ids схлопнуты). */
  onRoute: (ctx: TriggerContext) => void;
  obs?: TriggerObsContext;
};

export type TriggerLayer = {
  fire: (ctx: TriggerContext) => void;
  dispose: () => void;
};

function mergeIds(a?: string[], b?: string[]): string[] | undefined {
  if (!a?.length && !b?.length) return undefined;
  return [...new Set([...(a ?? []), ...(b ?? [])])];
}

export function createTriggerLayer(options: TriggerLayerOptions): TriggerLayer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: TriggerContext | null = null;

  const flush = (): void => {
    timer = null;
    if (!pending) return;
    const ctx = pending;
    pending = null;
    options.onRoute(ctx);
  };

  return {
    fire(ctx) {
      if (options.gate && !options.gate(ctx)) return;
      if (options.obs) reportTrigger(options.obs, ctx.source === "system" ? "manual" : ctx.source);

      if (!options.debounceMs) {
        options.onRoute(ctx);
        return;
      }

      pending = pending
        ? { ...ctx, ids: mergeIds(pending.ids, ctx.ids) }
        : { ...ctx, ids: ctx.ids ? [...ctx.ids] : undefined };

      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, options.debounceMs);
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}
