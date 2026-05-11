import type { EventLocation, GeoEnrichmentArtifact, GeoPipelineReport } from "@radar/shared";
import type { GeoPipelineStep } from "../geo-pipeline/GeoPipelineContext.js";
import { runGeoPipeline } from "../geo-pipeline/runGeoPipeline.js";

export class LocationResolutionService {
  constructor(private readonly steps: GeoPipelineStep[]) {}
async resolve(rawText: string): Promise<{
    locations: EventLocation[];
    artifact: GeoEnrichmentArtifact;
    geoPipeline: GeoPipelineReport;
  }> {
    return runGeoPipeline(rawText, this.steps);
  }
}
