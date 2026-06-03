import type { DataSource } from "typeorm";

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
};

async function deleteReturningCount(
  dataSource: DataSource,
  sql: string,
): Promise<number> {
  const rows = (await dataSource.query(sql)) as unknown[];
  return rows.length;
}

/** DELETE для таблицы, которой может не быть на стенде без полного migration:run. */
async function deleteOptional(
  dataSource: DataSource,
  sql: string,
): Promise<number> {
  try {
    return await deleteReturningCount(dataSource, sql);
  } catch {
    return 0;
  }
}

/**
 * Полный сброс гео-справочника: places, geo_feature, regions.
 * Операционный слой (raw, parsed) должен быть очищен до вызова.
 */
export async function wipeGeoCatalog(
  dataSource: DataSource,
  options: { includeRegions?: boolean } = {},
): Promise<WipeGeoCatalogResult> {
  const includeRegions = options.includeRegions !== false;

  let regionsCanonicalCleared = 0;
  try {
    const canonicalRows = (await dataSource.query(
      `UPDATE regions SET canonical_place_id = NULL WHERE canonical_place_id IS NOT NULL RETURNING id`,
    )) as Array<{ id: string }>;
    regionsCanonicalCleared = canonicalRows.length;
  } catch {
    // optional column
  }

  try {
    await dataSource.query(
      `UPDATE regions SET geometry_artifact_key = NULL WHERE geometry_artifact_key IS NOT NULL`,
    );
  } catch {
    // optional column
  }

  const regionStateHistoryDeleted = await deleteOptional(
    dataSource,
    `DELETE FROM region_state_history RETURNING region_id`,
  );
  const regionStateActiveDeleted = await deleteOptional(
    dataSource,
    `DELETE FROM region_state_active RETURNING region_id`,
  );

  const placeGeoLinksDeleted = await deleteOptional(
    dataSource,
    `DELETE FROM place_geo_link RETURNING id`,
  );
  const geoFeaturesDeleted = await deleteOptional(
    dataSource,
    `DELETE FROM geo_feature RETURNING id`,
  );

  const aliasesDeleted = await deleteReturningCount(
    dataSource,
    `DELETE FROM place_aliases RETURNING id`,
  );

  await dataSource.query(`DELETE FROM places WHERE parent_place_id IS NOT NULL`);
  const placesDeleted = await deleteReturningCount(
    dataSource,
    `DELETE FROM places RETURNING id`,
  );

  const geoDatasetFilesDeleted = await deleteOptional(
    dataSource,
    `DELETE FROM geo_dataset_file RETURNING artifact_key`,
  );

  let regionsDeleted = 0;
  if (includeRegions) {
    regionsDeleted = await deleteReturningCount(
      dataSource,
      `DELETE FROM regions RETURNING id`,
    );
  }

  return {
    regionsCanonicalCleared,
    regionStateHistoryDeleted,
    regionStateActiveDeleted,
    placeGeoLinksDeleted,
    geoFeaturesDeleted,
    geoDatasetFilesDeleted,
    aliasesDeleted,
    placesDeleted,
    regionsDeleted,
  };
}
