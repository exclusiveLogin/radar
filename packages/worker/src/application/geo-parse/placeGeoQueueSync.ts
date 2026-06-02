import type {
  IPlaceEnrichmentJobRepository,
  PlaceEnrichmentProvider,
} from "@radar/shared";

/**
 * geoParse: ставит jobs по каталогу places, без привязки к raw_messages.
 * Условие — провайдер ещё не в evidence_providers (или job failed для повтора).
 */
export async function syncPlaceGeoQueueForProvider(
  jobs: IPlaceEnrichmentJobRepository,
  provider: PlaceEnrichmentProvider,
): Promise<number> {
  const { enqueued } = await jobs.enqueueCatchUp(provider);
  return enqueued;
}
