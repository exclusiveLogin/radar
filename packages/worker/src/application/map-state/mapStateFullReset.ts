import type {
  IPlaceStatusRepository,
  IRegionRepository,
  IRegionStateRepository,
  RegionRecord,
} from "@radar/shared";

type ResetDeps = {
  regionState: IRegionStateRepository;
  placeStatus: IPlaceStatusRepository;
  regions: IRegionRepository;
};

export type MapStateFullResetResult = {
  placesCleared: number;
  regionsGrey: number;
};

/**
 * Полный сброс операционной карты перед batch reparse:
 * place_status_active → deactivate, region_state_active → grey (+ history для WS).
 */
export class MapStateFullReset {
  constructor(private readonly deps: ResetDeps) {}

  async run(
    at: Date = new Date(),
    reason = "reparse:full-reset",
  ): Promise<MapStateFullResetResult> {
    const atIso = at.toISOString();
    const placesCleared = await this.clearAllPlaceStatuses(atIso);
    const regionsGrey = await this.clearAllRegionStates(atIso, reason);
    return { placesCleared, regionsGrey };
  }

  private async clearAllPlaceStatuses(atIso: string): Promise<number> {
    const active = await this.deps.placeStatus.listAllActive();
    for (const row of active) {
      await this.deps.placeStatus.deactivate(row.placeId, row.statusCode, atIso);
    }
    return active.length;
  }

  private async clearAllRegionStates(atIso: string, reason: string): Promise<number> {
    const rows = await this.deps.regionState.listAll();
    if (rows.length === 0) {
      return 0;
    }

    const regionIndex = await this.buildRegionIndex();
    let written = 0;

    for (const row of rows) {
      if (row.stateLevel === "grey" && row.selfLevel === "grey" && row.activity === 0) {
        continue;
      }

      const region = regionIndex.byIso.get(row.regionCode);
      if (!region) {
        continue;
      }

      await this.deps.regionState.upsert({
        regionId: region.id,
        regionCode: row.regionCode,
        stateLevel: "grey",
        selfLevel: "grey",
        activity: 0,
        reason,
        updatedAt: atIso,
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

  private async buildRegionIndex(): Promise<{
    byIso: Map<string, RegionRecord>;
  }> {
    const regions = await this.deps.regions.listActive();
    const byIso = new Map<string, RegionRecord>();
    for (const region of regions) {
      if (region.iso) {
        byIso.set(region.iso, region);
      }
    }
    return { byIso };
  }
}
