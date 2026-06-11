import type { DataSource } from "typeorm";
import type { WipeLogger } from "./wipeLog.js";
import type { TruncateOptions } from "./wipeTableSql.js";

export type ClearOperationalMapStateResult = {
  placesCleared: number;
  regionsCleared: number;
};

/**
 * Legacy hook после удаления read_model (фаза 3).
 * Состояние карты живёт в event_locations; сброс — через TRUNCATE parsed_events.
 */
export async function clearOperationalMapState(
  _dataSource: DataSource,
  reason: string,
  options: Pick<TruncateOptions, "log" | "forceLocks"> = {},
): Promise<ClearOperationalMapStateResult> {
  options.log?.detail(`map-state: skip read_model (${reason}), facts via parsed_events wipe`);
  return { placesCleared: 0, regionsCleared: 0 };
}
