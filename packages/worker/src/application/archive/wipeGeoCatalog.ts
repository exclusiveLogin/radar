import type { OperationalSql } from "../phases/operationalSql.port.js";
import {
  countTableRows,
  runSqlOptional,
  truncateGroupCounted,
} from "./wipeTableSql.js";
import { runWipeStep, type WipeStepOptions } from "./wipeStepReporter.js";

export type WipeGeoCatalogResult = {
  regionsCanonicalCleared: number;
  regionStateHistoryDeleted: number;
  regionStateActiveDeleted: number;
  placeGeoLinksDeleted: number;
  geoFeaturesDeleted: number;
  geoDatasetFilesDeleted: number;
  aliasesDeleted: number;
  placesDeleted: number;
  regionsDeleted: number;
  regionAdjacencyDeleted: number;
};

const CATALOG_TABLES = [
  "region_adjacency",
  "place_geo_link",
  "geo_feature",
  "place_aliases",
  "places",
  "geo_dataset_file",
  "regions",
] as const;

/**
 * Полный сброс гео-справочника: places, geo_feature, regions.
 */
export async function wipeGeoCatalog(
  sql: OperationalSql,
  options: { includeRegions?: boolean } & WipeStepOptions = {},
): Promise<WipeGeoCatalogResult> {
  const includeRegions = options.includeRegions !== false;
  const { log } = options;

  await runWipeStep(options, "unlink FK (regions, places)", async () => {
    log?.detail("regions.canonical_place_id, geometry_artifact_key → NULL");
    log?.detail("places.geo_feature_id, geometry_artifact_key → NULL");
    log?.detail("mat_parse_location.place_id → NULL");
    await runSqlOptional(
      sql,
      `UPDATE regions SET canonical_place_id = NULL WHERE canonical_place_id IS NOT NULL`,
      log,
    );
    await runSqlOptional(
      sql,
      `UPDATE regions SET geometry_artifact_key = NULL WHERE geometry_artifact_key IS NOT NULL`,
      log,
    );
    await runSqlOptional(
      sql,
      `UPDATE places SET geo_feature_id = NULL WHERE geo_feature_id IS NOT NULL`,
      log,
    );
    await runSqlOptional(
      sql,
      `UPDATE places SET geometry_artifact_key = NULL WHERE geometry_artifact_key IS NOT NULL`,
      log,
    );
    await runSqlOptional(
      sql,
      `UPDATE mat_parse_location SET place_id = NULL WHERE place_id IS NOT NULL`,
      log,
    );
    return 0;
  });

  const tables = includeRegions
    ? [...CATALOG_TABLES]
    : CATALOG_TABLES.filter((table) => table !== "regions");

  log?.detail(`снимок до TRUNCATE (${tables.length} таблиц)…`);
  const placesDeleted = await countTableRows(sql, "places", log);
  const aliasesDeleted = await countTableRows(sql, "place_aliases", log);
  const geoFeaturesDeleted = await countTableRows(sql, "geo_feature", log);
  const placeGeoLinksDeleted = await countTableRows(sql, "place_geo_link", log);
  const geoDatasetFilesDeleted = await countTableRows(sql, "geo_dataset_file", log);
  const regionAdjacencyDeleted = await countTableRows(sql, "region_adjacency", log);
  const regionStateHistoryDeleted = 0;
  const regionStateActiveDeleted = 0;
  const regionsDeleted = includeRegions
    ? await countTableRows(sql, "regions", log)
    : 0;

  log?.detail(
    `до wipe: places=${placesDeleted}, regions=${regionsDeleted}, geo_feature=${geoFeaturesDeleted}, aliases=${aliasesDeleted}`,
  );

  await runWipeStep(options, "geo-каталог (TRUNCATE CASCADE)", async () =>
    truncateGroupCounted(sql, tables, {
      cascade: true,
      log,
      forceLocks: options.forceLocks,
    }),
  );

  return {
    regionsCanonicalCleared: 0,
    regionStateHistoryDeleted,
    regionStateActiveDeleted,
    placeGeoLinksDeleted,
    geoFeaturesDeleted,
    geoDatasetFilesDeleted,
    aliasesDeleted,
    placesDeleted,
    regionsDeleted,
    regionAdjacencyDeleted,
  };
}
