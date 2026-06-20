import type {
  IPlaceEnrichmentJobRepository,
  PlaceEnrichmentProvider,
} from "@radar/shared";

/**
 * geoParse: jobs SSOT — drain через claimEligibleBatch (pull batch).
 */
export async function syncPlaceGeoQueueForProvider(
  jobs: IPlaceEnrichmentJobRepository,
  provider: PlaceEnrichmentProvider,
): Promise<number> {
  const { enqueued } = await jobs.enqueueCatchUp(provider);
  return enqueued;
}
