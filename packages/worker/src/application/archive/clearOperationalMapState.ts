import type { DataSource } from "typeorm";
import type { WipeLogger } from "./wipeLog.js";
import type { TruncateOptions } from "./wipeTableSql.js";

export type ClearOperationalMapStateResult = {
  placesCleared: number;
  regionsCleared: number;
};

/**
 * Legacy hook после удаления read_model (фаза 3).
 * Состояние карты живёт в mat_parse_location; сброс — через TRUNCATE mat_parse_event.
 */
export async function clearOperationalMapState(
  _dataSource: DataSource,
  reason: string,
  options: Pick<TruncateOptions, "log" | "forceLocks"> = {},
): Promise<ClearOperationalMapStateResult> {
  options.log?.detail(`map-state: skip read_model (${reason}), facts via mat_parse_event wipe`);
  return { placesCleared: 0, regionsCleared: 0 };
}
