/**
 * ---
 * layer: worker/application
 * domain: tracking/pipeline
 * purpose: Реестр доступных фаз по id — источник для phase runner.
 * ---
 */
import type { TrackingStep, TrackingStepId } from "./trackingStepContracts.js";

export type TrackingStepRegistry = ReadonlyMap<TrackingStepId, TrackingStep>;

export function createTrackingStepRegistry(
  phases: readonly TrackingStep[],
): TrackingStepRegistry {
  const registry = new Map<TrackingStepId, TrackingStep>();
  for (const phase of phases) registry.set(phase.id, phase);
  return registry;
}
