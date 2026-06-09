import type {
  EventLocation,
  GeoEnrichmentArtifact,
  GeoPipelineReport,
} from "@radar/shared";
import type {
  GeoPipelineContext,
  GeoPipelinePhaseMode,
  GeoPipelineStep,
} from "./GeoPipelineContext.js";
import { MergeStep } from "./steps/MergeStep.js";

export type GeoPipelineResult = {
  locations: EventLocation[];
  artifact: GeoEnrichmentArtifact;
  geoPipeline: GeoPipelineReport;
};

export type RunGeoPipelineOptions = {
  initialArtifact?: GeoEnrichmentArtifact;
  priorValidatedLocations?: EventLocation[];
  phaseMode?: GeoPipelinePhaseMode;
};

/**
 * Runs every enabled step sequentially, passing the mutable artifact context.
 * Steps write only their own namespace and may read any already-populated ones.
 * The terminal MergeStep is always appended last (ADR-003).
 */
export async function runGeoPipeline(
  rawText: string,
  steps: GeoPipelineStep[],
  options: RunGeoPipelineOptions = {},
): Promise<GeoPipelineResult> {
  const locations: EventLocation[] = [];
  const artifact: GeoEnrichmentArtifact = structuredClone(options.initialArtifact ?? {});
  const stepLog: GeoPipelineReport["steps"] = [];

  const mergeStep = new MergeStep(locations);
  const allSteps = [...steps, mergeStep];

  const ctx: GeoPipelineContext = {
    rawText,
    artifact,
    stepLog,
    priorValidatedLocations: options.priorValidatedLocations,
    phaseMode: options.phaseMode,
  };

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
