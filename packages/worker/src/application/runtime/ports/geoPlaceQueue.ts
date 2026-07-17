import type {
  IPlaceEnrichmentJobRepository,
  IWorkQueue,
  PlaceEnrichmentJobRecord,
  PlaceEnrichmentProvider,
} from "@radar/shared";

export type GeoPlaceQueueDeps = {
  placeJobs: IPlaceEnrichmentJobRepository;
  provider: PlaceEnrichmentProvider;
  placeIds?: string[];
};

/** IWorkQueue adapter для job_geo_place_enrich — доменная логика в PlaceEnrichmentRunner. */
export function createGeoPlaceQueue(
  deps: GeoPlaceQueueDeps,
): IWorkQueue<PlaceEnrichmentJobRecord> {
  return {
    async planPending(limit?: number) {
      const result = await deps.placeJobs.enqueueCatchUp(deps.provider);
      return { planned: limit ? Math.min(result.enqueued, limit) : result.enqueued };
    },
    async claimBatch(limit) {
      if (deps.placeIds?.length) {
        return deps.placeJobs.claimForPlaceIds(deps.provider, deps.placeIds);
      }
      return deps.placeJobs.claimEligibleBatch(deps.provider, limit);
    },
    markCompleted(id) {
      return deps.placeJobs.markDone(id);
    },
    markFailed(id, error) {
      return deps.placeJobs.markFailed(id, error);
    },
  };
}
