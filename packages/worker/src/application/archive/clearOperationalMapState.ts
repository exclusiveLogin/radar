import type { DataSource } from "typeorm";

export type ClearOperationalMapStateResult = {
  placesCleared: number;
  regionsCleared: number;
};

/**
 * Сброс read-model карты: удаляет materialized winner-срез.
 */
export async function clearOperationalMapState(
  dataSource: DataSource,
  _reason: string,
): Promise<ClearOperationalMapStateResult> {
  const places = (await dataSource.query(
    `DELETE FROM place_status_read_model RETURNING place_id`,
  )) as Array<{ place_id: string }>;

  const regions = (await dataSource.query(
    `DELETE FROM region_status_read_model RETURNING region_id`,
  )) as Array<{ region_id: string }>;

  return {
    placesCleared: places.length,
    regionsCleared: regions.length,
  };
}
