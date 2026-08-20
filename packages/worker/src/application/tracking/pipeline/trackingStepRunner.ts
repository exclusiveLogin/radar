/**
 * ---
 * layer: worker/application
 * domain: tracking/pipeline
 * purpose: Исполняет манифест фаз над payload — без знания о конкретном алгоритме.
 * ---
 */
import type {
  TrackingStepDeps,
  TrackingStepManifest,
  TrackingStepPayload,
} from "./trackingStepContracts.js";
import type { TrackingStepRegistry } from "./trackingStepRegistry.js";

export function runTrackingSteps(
  manifest: TrackingStepManifest,
  registry: TrackingStepRegistry,
  payload: TrackingStepPayload,
  deps: TrackingStepDeps,
): TrackingStepPayload {
  let current = payload;
  for (const entry of manifest) {
    if (!entry.enabled) continue;
    const phase = registry.get(entry.id);
    if (!phase) continue;
    current = phase.run(current, deps);
  }
  return current;
}
