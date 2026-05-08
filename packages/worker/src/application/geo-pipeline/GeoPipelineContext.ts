import type { GeoEnrichmentArtifact, GeoPipelineReport } from "@radar/shared";

export type GeoPipelineContext = {
  rawText: string;
  artifact: GeoEnrichmentArtifact;
  stepLog: GeoPipelineReport["steps"];
};

export interface GeoPipelineStep {
  readonly id: string;
  run(ctx: GeoPipelineContext): Promise<void>;
}
