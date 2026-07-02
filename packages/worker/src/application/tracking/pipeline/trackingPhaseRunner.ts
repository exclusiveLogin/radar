/**
 * ---
 * layer: worker/application
 * domain: tracking/pipeline
 * purpose: Исполняет манифест фаз над payload — без знания о конкретном алгоритме.
 * ---
 */
import type {
  TrackingPhaseDeps,
  TrackingPhaseManifest,
  TrackingPhasePayload,
} from "./trackingPhaseContracts.js";
import type { TrackingPhaseRegistry } from "./trackingPhaseRegistry.js";

export function runTrackingPhases(
  manifest: TrackingPhaseManifest,
  registry: TrackingPhaseRegistry,
  payload: TrackingPhasePayload,
  deps: TrackingPhaseDeps,
): TrackingPhasePayload {
  let current = payload;
  for (const entry of manifest) {
    if (!entry.enabled) continue;
    const phase = registry.get(entry.id);
    if (!phase) continue;
    current = phase.run(current, deps);
  }
  return current;
}
