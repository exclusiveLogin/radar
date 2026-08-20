import { clearOperationalMapState } from "../archive/clearOperationalMapState.js";
import type { OperationalSql } from "../phases/operationalSql.port.js";

type ResetDeps = {
  operationalSql: OperationalSql;
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
    const map = await clearOperationalMapState(this.deps.operationalSql, reason);
    return {
      placesCleared: map.placesCleared,
      regionsGrey: map.regionsCleared,
    };
  }
}
