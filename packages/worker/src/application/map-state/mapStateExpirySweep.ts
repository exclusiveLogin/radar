import type {
  IPlaceStatusRepository,
  IRegionRepository,
  IRegionStateRepository,
  RegionRecord,
  StateLevel,
} from "@radar/shared";
import { computeEffectiveLevel } from "../../domain/region-state/regionStateMachine.js";

type SweepDeps = {
  regionState: IRegionStateRepository;
  placeStatus: IPlaceStatusRepository;
  regions: IRegionRepository;
  adjacency: Record<string, string[]>;
  ttlMs: number;
};

export type MapStateExpiryResult = {
  regionsExpired: number;
  placesExpired: number;
};


/**
 * Сбрасывает устаревшие статусы: регионы → grey, места → deactivate.
 * TTL по времени события (status_event_at / meta.statusEventAt), не по updated_at проекции.
 * Пишет history — API-поллеры отдадут изменения по WS.
 */
export class MapStateExpirySweep {
  constructor(private readonly deps: SweepDeps) {}

  async run(at: Date = new Date()): Promise<MapStateExpiryResult> {
    const cutoffIso = new Date(at.getTime() - this.deps.ttlMs).toISOString();
    const ttlReason = `ttl:${Math.round(this.deps.ttlMs / 3_600_000)}h`;
    const placesExpired = await this.expirePlaces(cutoffIso, at.toISOString());
    const regionsExpired = await this.expireRegions(
      cutoffIso,
      at.toISOString(),
      ttlReason,
    );
    return { regionsExpired, placesExpired };
  }

  private async expirePlaces(cutoffIso: string, atIso: string): Promise<number> {
    const stale = await this.deps.placeStatus.listActiveUpdatedBefore(cutoffIso);
    for (const row of stale) {
      await this.deps.placeStatus.deactivate(row.placeId, row.statusCode, atIso);
    }
    return stale.length;
  }

  private async expireRegions(
    cutoffIso: string,
    atIso: string,
    ttlReason: string,
  ): Promise<number> {
    const stale = await this.deps.regionState.listAlarmUpdatedBefore(cutoffIso);
    if (stale.length === 0) return 0;

    const expiredIso = new Set(stale.map((row) => row.regionCode));
    const regionIndex = await this.buildRegionIndex();
    const state = await this.loadState();

    for (const iso of expiredIso) {
      state.selfByIso.set(iso, "grey");
      state.activityByIso.set(iso, 0);
    }

    const toRecompute = this.expandWithNeighbors(expiredIso);
    let written = 0;

    for (const iso of toRecompute) {
      const region = regionIndex.byIso.get(iso);
      if (!region) continue;

      const selfLevel = state.selfByIso.get(iso) ?? "grey";
      const neighborLevels = (this.deps.adjacency[iso] ?? []).map(
        (n) => state.selfByIso.get(n) ?? "grey",
      );
      const effective = computeEffectiveLevel(selfLevel, neighborLevels);
      const previous = state.effectiveByIso.get(iso) ?? "grey";
      const ttlCleared = expiredIso.has(iso);
      if (effective.level === previous && !ttlCleared) continue;

      const statusEventAt =
        effective.level === "grey"
          ? null
          : state.statusEventAtByIso.get(iso) ?? null;

      await this.deps.regionState.upsert({
        regionId: region.id,
        regionCode: iso,
        stateLevel: effective.level,
        selfLevel,
        activity: state.activityByIso.get(iso) ?? 0,
        reason: ttlCleared ? ttlReason : effective.reason,
        updatedAt: atIso,
        statusEventAt,
      });
      await this.deps.regionState.appendHistory({
        regionId: region.id,
        regionCode: iso,
        stateLevel: effective.level,
        previousLevel: previous,
        reason: expiredIso.has(iso) ? ttlReason : effective.reason,
        changedAt: atIso,
      });
      state.effectiveByIso.set(iso, effective.level);
      if (expiredIso.has(iso)) written += 1;
    }

    return written;
  }

  private async buildRegionIndex(): Promise<{
    byIso: Map<string, RegionRecord>;
  }> {
    const regions = await this.deps.regions.listActive();
    const byIso = new Map<string, RegionRecord>();
    for (const region of regions) {
      if (region.iso) byIso.set(region.iso, region);
    }
    return { byIso };
  }

  private async loadState(): Promise<{
    selfByIso: Map<string, StateLevel>;
    effectiveByIso: Map<string, StateLevel>;
    activityByIso: Map<string, number>;
    statusEventAtByIso: Map<string, string>;
  }> {
    const rows = await this.deps.regionState.listAll();
    const selfByIso = new Map<string, StateLevel>();
    const effectiveByIso = new Map<string, StateLevel>();
    const activityByIso = new Map<string, number>();
    const statusEventAtByIso = new Map<string, string>();
    for (const row of rows) {
      selfByIso.set(row.regionCode, row.selfLevel);
      effectiveByIso.set(row.regionCode, row.stateLevel);
      activityByIso.set(row.regionCode, row.activity);
      if (row.statusEventAt) {
        statusEventAtByIso.set(row.regionCode, row.statusEventAt);
      }
    }
    return { selfByIso, effectiveByIso, activityByIso, statusEventAtByIso };
  }

  private expandWithNeighbors(affectedIso: Set<string>): Set<string> {
    const result = new Set<string>(affectedIso);
    for (const iso of affectedIso) {
      for (const neighbor of this.deps.adjacency[iso] ?? []) {
        result.add(neighbor);
      }
    }
    return result;
  }
}
