import type {
  EventLocation,
  GeoEnrichmentArtifact,
  GeoPipelineReport,
} from "@radar/shared";
import type { GeoPipelinePhaseMode } from "../geo-pipeline/GeoPipelineContext.js";
import type { GeoPipelineStep } from "../geo-pipeline/GeoPipelineContext.js";
import { runGeoPipeline } from "../geo-pipeline/runGeoPipeline.js";

export type GeoPipelineResolveContext = {
  initialArtifact?: GeoEnrichmentArtifact;
  priorValidatedLocations?: EventLocation[];
  phaseMode?: GeoPipelinePhaseMode;
};

export class LocationResolutionService {
  constructor(private readonly steps: GeoPipelineStep[]) {}

  async resolve(
    rawText: string,
    geoContext: GeoPipelineResolveContext = {},
  ): Promise<{
    locations: EventLocation[];
    artifact: GeoEnrichmentArtifact;
    geoPipeline: GeoPipelineReport;
  }> {
    return runGeoPipeline(rawText, this.steps, geoContext);
  }
}
