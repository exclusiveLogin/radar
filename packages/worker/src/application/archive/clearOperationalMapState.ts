import type { DataSource } from "typeorm";

export type ClearOperationalMapStateResult = {
  placesActiveRemoved: number;
  placeHistoryRemoved: number;
  regionsGrey: number;
  regionHistoryRemoved: number;
};

/**
 * Сброс операционной карты: все регионы → grey, снять активные places, очистить history.
 * SQL по region_code — без пропусков «сирот» вне справочника regions.
 */
export async function clearOperationalMapState(
  dataSource: DataSource,
  reason: string,
): Promise<ClearOperationalMapStateResult> {
  const placesActive = (await dataSource.query(
    `DELETE FROM place_status_active RETURNING place_id`,
  )) as Array<{ place_id: string }>;

  const placeHistory = (await dataSource.query(
    `DELETE FROM place_status_history RETURNING id`,
  )) as Array<{ id: string }>;

  const regionsGrey = (await dataSource.query(
    `UPDATE region_state_active SET
       state_level = 'grey',
       self_level = 'grey',
       activity = 0,
       reason = $1,
       status_event_at = NULL,
       updated_at = now()
     RETURNING region_id`,
    [reason],
  )) as Array<{ region_id: string }>;

  const regionHistory = (await dataSource.query(
    `DELETE FROM region_state_history RETURNING id`,
  )) as Array<{ id: string }>;

  return {
    placesActiveRemoved: placesActive.length,
    placeHistoryRemoved: placeHistory.length,
    regionsGrey: regionsGrey.length,
    regionHistoryRemoved: regionHistory.length,
  };
}
