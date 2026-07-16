import type {
  DomainEvent,
  IPhaseDefinitionRepository,
  IPlaceEnrichmentJobRepository,
  PlaceEnrichmentProvider,
} from "@radar/shared";
import { resolveGeoEnrichmentProvider } from "@radar/shared";
import { extractPlaceIdsFromParsedPayload } from "../runtime/workload/pipelineWakeContract.js";

export type GeoPlaceIngestHandlerDeps = {
  phases: IPhaseDefinitionRepository;
  placeJobs: IPlaceEnrichmentJobRepository;
  onWake?: () => void;
};

/** MessageParsed → enqueue placeIds в job_geo_place_enrich + wake geo. */
export function createGeoPlaceIngestHandler(
  deps: GeoPlaceIngestHandlerDeps,
): (event: DomainEvent) => Promise<void> {
  return async (event: DomainEvent) => {
    if (event.type !== "MessageParsed") return;
    const placeIds = extractPlaceIdsFromParsedPayload(
      event.payload as Record<string, unknown>,
    );
    if (placeIds.length === 0) {
      deps.onWake?.();
      return;
    }

    const geoPhases = await deps.phases.listEnabled(undefined, "geoParse");
    const providers = new Set<PlaceEnrichmentProvider>();
    for (const phase of geoPhases) {
      const provider = resolveGeoEnrichmentProvider(phase);
      if (provider) providers.add(provider);
    }

    for (const provider of providers) {
      for (const placeId of placeIds) {
        await deps.placeJobs.enqueue(placeId, provider);
      }
    }
    deps.onWake?.();
  };
}