import type { EventLocation, GeoEnrichmentArtifact, GeoPipelineReport } from "@radar/shared";
import type { GeoPipelineContext, GeoPipelineStep } from "./GeoPipelineContext.js";
import { MergeStep } from "./steps/MergeStep.js";

export type GeoPipelineResult = {
  locations: EventLocation[];
  artifact: GeoEnrichmentArtifact;
  geoPipeline: GeoPipelineReport;
};

/**
 * Runs every enabled step sequentially, passing the mutable artifact context.
 * Steps write only their own namespace and may read any already-populated ones.
 * The terminal MergeStep is always appended last (ADR-003).
 */
export async function runGeoPipeline(
  rawText: string,
  steps: GeoPipelineStep[],
): Promise<GeoPipelineResult> {
  const locations: EventLocation[] = [];
  const artifact: GeoEnrichmentArtifact = {};
  const stepLog: GeoPipelineReport["steps"] = [];

  const mergeStep = new MergeStep(locations);
  const allSteps = [...steps, mergeStep];

  const ctx: GeoPipelineContext = { rawText, artifact, stepLog };

  for (const step of allSteps) {
    const startedAt = performance.now();
    try {
      await step.run(ctx);
      stepLog.push({
        id: step.id,
        ok: true,
        durationMs: Math.round(performance.now() - startedAt),
      });
    } catch {
      stepLog.push({
        id: step.id,
        ok: false,
        durationMs: Math.round(performance.now() - startedAt),
      });
    }
  }

  return { locations, artifact, geoPipeline: { steps: stepLog } };
}
