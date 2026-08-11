/**
 * ---
 * layer: worker/application
 * domain: pipeline/step
 * purpose: Реестр reset-handler'ов по имени из step.resets.handler.
 * ---
 */
import type { PhaseOperationalDeps } from "../../phases/phaseOperationalDeps.js";
import {
  createGeoStepResetPort,
  createIngestStepResetPort,
  createParseStepResetPort,
  createTrackingStepResetPort,
} from "./stepResetAdapters.js";
import type { StepResetPort } from "./stepResetPort.js";

/** Собирает порты по handler name из pipeline.manifest. */
export function createStepResetRegistry(
  deps: PhaseOperationalDeps,
): Map<string, StepResetPort> {
  return new Map<string, StepResetPort>([
    ["parse", createParseStepResetPort(deps)],
    ["geo", createGeoStepResetPort(deps)],
    ["tracking", createTrackingStepResetPort(deps)],
    ["ingest", createIngestStepResetPort(deps)],
  ]);
}

export function resolveStepResetPort(
  registry: Map<string, StepResetPort>,
  handler: string,
): StepResetPort {
  const port = registry.get(handler);
  if (!port) {
    throw new Error(`step reset handler not registered: ${handler}`);
  }
  return port;
}
