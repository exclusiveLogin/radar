import type {
  IPlaceStatusRepository,
  IRegionRepository,
  IRegionStateRepository,
} from "@radar/shared";
import type { DataSource } from "typeorm";
import { clearOperationalMapState } from "../archive/clearOperationalMapState.js";

type ResetDeps = {
  regionState: IRegionStateRepository;
  placeStatus: IPlaceStatusRepository;
  regions: IRegionRepository;
  /** Для SQL-сброса карты без «сирот»; если не передан — legacy через repos (не рекомендуется). */
  dataSource?: DataSource;
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
    at: Date = new Date(),
    reason = "reparse:full-reset",
  ): Promise<MapStateFullResetResult> {
    if (this.deps.dataSource) {
      const map = await clearOperationalMapState(this.deps.dataSource, reason);
      return {
        placesCleared: map.placesActiveRemoved,
        regionsGrey: map.regionsGrey,
      };
    }

    const atIso = at.toISOString();
    const placesCleared = await this.clearAllPlaceStatuses(atIso);
    const regionsGrey = await this.clearAllRegionStatesLegacy(atIso, reason);
    return { placesCleared, regionsGrey };
  }

  private async clearAllPlaceStatuses(atIso: string): Promise<number> {
    const active = await this.deps.placeStatus.listAllActive();
    for (const row of active) {
      await this.deps.placeStatus.deactivate(row.placeId, row.statusCode, atIso);
    }
    return active.length;
  }

  /** @deprecated используй clearOperationalMapState через dataSource */
  private async clearAllRegionStatesLegacy(atIso: string, reason: string): Promise<number> {
    const rows = await this.deps.regionState.listAll();
    const regions = await this.deps.regions.listActive();
    const byIso = new Map(regions.filter((r) => r.iso).map((r) => [r.iso!, r]));
    let written = 0;
    for (const row of rows) {
      if (row.stateLevel === "grey" && row.selfLevel === "grey" && row.activity === 0) {
        continue;
      }
      const region = byIso.get(row.regionCode);
      if (!region) continue;
      await this.deps.regionState.upsert({
        regionId: region.id,
        regionCode: row.regionCode,
        stateLevel: "grey",
        selfLevel: "grey",
        activity: 0,
        reason,
        updatedAt: atIso,
        statusEventAt: null,
      });
      await this.deps.regionState.appendHistory({
        regionId: region.id,
        regionCode: row.regionCode,
        stateLevel: "grey",
        previousLevel: row.stateLevel,
        reason,
        changedAt: atIso,
      });
      written += 1;
    }
    return written;
  }
}
