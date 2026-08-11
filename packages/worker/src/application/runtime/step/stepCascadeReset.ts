/**
 * ---
 * layer: worker/application
 * domain: pipeline/step
 * purpose: Cascade reset: reverse topo (downstream first) по emits ∩ trigger.on.
 * ---
 */
import {
  cascadeResetOrder,
  type PipelineManifest,
} from "@radar/shared";
import type { PhaseOperationalDeps } from "../../phases/phaseOperationalDeps.js";
import {
  createStepResetRegistry,
  resolveStepResetPort,
} from "./stepResetRegistry.js";

export type StepCascadeResetResult = {
  order: string[];
  countsByStep: Record<string, Record<string, number>>;
};

/** Preview или apply reset с каскадом (или только root). */
export async function runStepCascadeReset(input: {
  deps: PhaseOperationalDeps;
  manifest: PipelineManifest;
  rootStepId: string;
  cascade: boolean;
  dryRun: boolean;
}): Promise<StepCascadeResetResult> {
  const order = input.cascade
    ? cascadeResetOrder(input.manifest, input.rootStepId)
    : [input.rootStepId].filter((id) => {
        const step = input.manifest.steps.find((s) => s.id === id);
        return Boolean(step?.resets?.handler);
      });

  const registry = createStepResetRegistry(input.deps);
  const countsByStep: Record<string, Record<string, number>> = {};

  for (const stepId of order) {
    const step = input.manifest.steps.find((s) => s.id === stepId);
    const handler = step?.resets?.handler;
    if (!handler) continue;
    const port = resolveStepResetPort(registry, handler);
    countsByStep[stepId] = input.dryRun ? await port.preview() : await port.apply();
  }

  return { order, countsByStep };
}
