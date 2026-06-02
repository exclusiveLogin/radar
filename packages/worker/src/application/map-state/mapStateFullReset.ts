import type { DataSource } from "typeorm";
import { clearOperationalMapState } from "../archive/clearOperationalMapState.js";

type ResetDeps = {
  dataSource: DataSource;
};

export type MapStateFullResetResult = {
  placesCleared: number;
  regionsGrey: number;
};

/**
 * Полный сброс операционной карты перед batch reparse.
 */
export class MapStateFullReset {
  constructor(private readonly deps: ResetDeps) {}

  async run(
    _at: Date = new Date(),
    reason = "reparse:full-reset",
  ): Promise<MapStateFullResetResult> {
    const map = await clearOperationalMapState(this.deps.dataSource, reason);
    return {
      placesCleared: map.placesCleared,
      regionsGrey: map.regionsCleared,
    };
  }
}
