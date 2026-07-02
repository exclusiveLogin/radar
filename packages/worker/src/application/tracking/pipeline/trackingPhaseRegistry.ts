/**
 * ---
 * layer: worker/application
 * domain: tracking/pipeline
 * purpose: Реестр доступных фаз по id — источник для phase runner.
 * ---
 */
import type { TrackingPhase, TrackingPhaseId } from "./trackingPhaseContracts.js";

export type TrackingPhaseRegistry = ReadonlyMap<TrackingPhaseId, TrackingPhase>;

export function createTrackingPhaseRegistry(
  phases: readonly TrackingPhase[],
): TrackingPhaseRegistry {
  const registry = new Map<TrackingPhaseId, TrackingPhase>();
  for (const phase of phases) registry.set(phase.id, phase);
  return registry;
}
