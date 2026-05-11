import type { EventLocation } from "@radar/shared";
import type { GeoPipelineContext, GeoPipelineStep } from "../GeoPipelineContext.js";
import { buildFinalizerResult } from "./finalizerMerge.js";

/**
 * Merges all namespace nodes into a deduplicated flat list of EventLocations,
 * then writes `artifact.finalizer` and populates `ctx.locations`.
 *
 * Priority for coordinates: dadata > nominatim > catalog.
 */
export class FinalizerStep implements GeoPipelineStep {
  readonly id = "finalizer";

  constructor(private readonly locations: EventLocation[]) {}run(ctx: GeoPipelineContext): Promise<void> {
    const { finalizer, locations } = buildFinalizerResult(ctx.artifact);
    ctx.artifact.finalizer = finalizer;
    this.locations.push(...locations);

    return Promise.resolve();
  }
}
