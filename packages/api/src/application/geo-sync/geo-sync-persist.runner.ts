import type {
  IPlaceAliasRepository,
  IPlaceRepository,
  IRegionRepository,
  PlaceAliasRecord,
  PlaceRecord,
  RegionRecord,
} from "@radar/shared";
import type { IGeoSyncPersistReporter } from "./geo-sync.reporter.port";
import { upsertManyInChunks } from "./geoSyncBatchPersist";
import { syncRegionCanonicalPlaces } from "./region-place-mirror";

export type GeoSyncPersistRunnerInput = {
  regions: IRegionRepository;
  places: IPlaceRepository;
  aliases: IPlaceAliasRepository;
  regionRows: RegionRecord[];
  placeRows: PlaceRecord[];
  /** Строит alias rows после upsert places (нужен индекс из БД). */
  resolveAliasRows: (
    regionPlaceByRegionId: Map<string, string>,
  ) => Promise<PlaceAliasRecord[]>;
  reporter?: IGeoSyncPersistReporter;
};

/**
 * Batch-persist snapshot → DB: regions → region-places → places → aliases.
 * SRP: только запись; mapping/audit — в GeoSyncApplyService.
 */
export async function runGeoSyncPersist(input: GeoSyncPersistRunnerInput): Promise<void> {
  const { reporter, regionRows, placeRows } = input;

  reporter?.begin(regionRows.length + placeRows.length);

  try {
    await upsertManyInChunks(
      regionRows,
      (chunk) => input.regions.upsertMany(chunk),
      (delta) => reporter?.tick(delta),
    );

    const regionPlaceByRegionId = await syncRegionCanonicalPlaces(
      input.regions,
      input.places,
      input.aliases,
    );

    await upsertManyInChunks(
      placeRows,
      (chunk) => input.places.upsertMany(chunk),
      (delta) => reporter?.tick(delta),
    );

    const aliasRows = await input.resolveAliasRows(regionPlaceByRegionId);
    reporter?.extendTotal(aliasRows.length);

    await upsertManyInChunks(
      aliasRows,
      (chunk) => input.aliases.upsertMany(chunk),
      (delta) => reporter?.tick(delta),
    );
  } finally {
    reporter?.finish();
  }
}
