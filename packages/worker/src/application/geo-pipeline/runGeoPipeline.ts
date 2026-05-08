import type { EventLocation, GeoEnrichmentArtifact, GeoPipelineReport } from "@radar/shared";
import type { GeoPipelineContext, GeoPipelineStep } from "./GeoPipelineContext.js";
import { FinalizerStep } from "./steps/FinalizerStep.js";

export type GeoPipelineResult = {
  locations: EventLocation[];
  artifact: GeoEnrichmentArtifact;
  geoPipeline: GeoPipelineReport;
};

/**
 * Runs every enabled step sequentially, passing the mutable artifact context.
 * Steps write only their own namespace and may read any already-populated ones.
 * The FinalizerStep is always appended last.
 */
export async function runGeoPipeline(
  rawText: string,
  steps: GeoPipelineStep[],
): Promise<GeoPipelineResult> {
  const locations: EventLocation[] = [];
  const artifact: GeoEnrichmentArtifact = {};
  const stepLog: GeoPipelineReport["steps"] = [];

  const finalizer = new FinalizerStep(locations);
  const allSteps = [...steps, finalizer];

  const ctx: GeoPipelineContext = { rawText, artifact, stepLog };

  for (const step of allSteps) {
    const t = performance.now();
    try {
      await step.run(ctx);
      stepLog.push({
        id: step.id,
        ok: true,
        durationMs: Math.round(performance.now() - t),
      });
    } catch (err) {
      stepLog.push({
        id: step.id,
        ok: false,
        durationMs: Math.round(performance.now() - t),
      });
    }
  }

  return { locations, artifact, geoPipeline: { steps: stepLog } };
}
