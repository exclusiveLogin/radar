import type {
  EventLocation,
  GeoEnrichmentArtifact,
  GeoPipelineReport,
} from "@radar/shared";

export type GeoPipelinePhaseMode = "baseline" | "enrich";

export type GeoPipelineContext = {
  rawText: string;
  artifact: GeoEnrichmentArtifact;
  stepLog: GeoPipelineReport["steps"];
  priorValidatedLocations?: EventLocation[];
  phaseMode?: GeoPipelinePhaseMode;
};

export interface GeoPipelineStep {
  readonly id: string;
  run(ctx: GeoPipelineContext): Promise<void>;
}
