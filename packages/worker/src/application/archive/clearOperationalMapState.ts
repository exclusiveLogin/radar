import type { DataSource } from "typeorm";
import type { WipeLogger } from "./wipeLog.js";
import { truncateTables, type TruncateOptions } from "./wipeTableSql.js";

export type ClearOperationalMapStateResult = {
  placesCleared: number;
  regionsCleared: number;
};

const READ_MODEL_TABLES = ["place_status_read_model", "region_status_read_model"] as const;

/**
 * Сброс read-model карты: один TRUNCATE обеих таблиц.
 */
export async function clearOperationalMapState(
  dataSource: DataSource,
  _reason: string,
  options: Pick<TruncateOptions, "log" | "forceLocks"> = {},
): Promise<ClearOperationalMapStateResult> {
  const { log } = options;
  log?.detail(`read-model: ${READ_MODEL_TABLES.join(", ")}`);
  await truncateTables(dataSource, [...READ_MODEL_TABLES], options);
  return { placesCleared: 0, regionsCleared: 0 };
}
