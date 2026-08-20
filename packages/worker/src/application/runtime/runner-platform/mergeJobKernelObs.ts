/**
 * ---
 * layer: worker/runtime
 * domain: runner-platform
 * purpose: Склейка нескольких JobKernelObsPort (obs + stability) без дублирования wiring.
 * ---
 */
import type { JobKernelObsPort } from "./jobKernel.js";

/** Объединяет порты: все колбэки вызываются по порядку. Async onIdle/onBusy — await по цепочке. */
export function mergeJobKernelObs(
  ...ports: Array<JobKernelObsPort | undefined>
): JobKernelObsPort | undefined {
  const list = ports.filter((p): p is JobKernelObsPort => p != null);
  if (list.length === 0) return undefined;
  if (list.length === 1) return list[0];

  return {
    onRunning: () => {
      for (const p of list) p.onRunning?.();
    },
    onPaused: () => {
      for (const p of list) p.onPaused?.();
    },
    onStopped: () => {
      for (const p of list) p.onStopped?.();
    },
    onTickStart: () => {
      for (const p of list) p.onTickStart?.();
    },
    onTickEnd: (metrics) => {
      for (const p of list) p.onTickEnd?.(metrics);
    },
    onMaterialize: () => {
      for (const p of list) p.onMaterialize?.();
    },
    onLiveMetrics: (metrics) => {
      for (const p of list) p.onLiveMetrics?.(metrics);
    },
    onBusy: async () => {
      for (const p of list) await p.onBusy?.();
    },
    onIdle: async () => {
      for (const p of list) await p.onIdle?.();
    },
  };
}
