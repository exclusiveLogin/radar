import type {
  DomainEvent,
  EventHandler,
  IPlaceStatusRepository,
  IRegionRepository,
  IRegionStateRepository,
  IStatusDictionaryRepository,
  LocationPrecision,
  RegionRecord,
  StateLevel,
} from "@radar/shared";
import { planGreenPlaceStatusClear } from "../../domain/region-state/placeStatusClearPolicy.js";
import {
  computeEffectiveLevel,
  computeSelfLevel,
} from "../../domain/region-state/regionStateMachine.js";

type ParsedLocation = {
  regionId: string;
  regionCode: string;
  placeId?: string;
  precision: LocationPrecision;
};

type MessageParsedPayload = {
  eventType: string;
  direction?: string;
  postedAt?: string;
  locations?: ParsedLocation[];
};

type ProjectionDeps = {
  regionState: IRegionStateRepository;
  placeStatus: IPlaceStatusRepository;
  statusDictionary: IStatusDictionaryRepository;
  regions: IRegionRepository;
  /** Смежность регионов по ISO (data/geo/dictionaries/adjacency.json). */
  adjacency: Record<string, string[]>;
};

/**
 * Проекция операционного состояния регионов.
 * Подписывается на `MessageParsed`: пишет сигналы в place_status_active,
 * пересчитывает уровень региона (липкий автомат) + превентивный yellow у соседей red.
 * Запись в region_state_active/history — durable-журнал смен (его читает realtime-поллер API).
 *
 * Ключ соединения с adjacency/layout — ISO региона (region.iso).
 */
export class RegionStateProjection {
  private dictLevelByCode: Map<string, StateLevel> | null = null;

  constructor(private readonly deps: ProjectionDeps) {}

  readonly handler: EventHandler = async (event: DomainEvent): Promise<void> => {
    if (event.type !== "MessageParsed") return;
    const payload = event.payload as MessageParsedPayload;
    const locations = payload.locations ?? [];
    if (locations.length === 0) return;

    const incoming = await this.resolveIncomingLevel(payload.eventType);
    const at = payload.postedAt ?? event.occurredAt;
    const statusCode = payload.eventType;

    const regionIndex = await this.buildRegionIndex();
    await this.writePlaceStatuses(locations, statusCode, incoming, at);

    const affectedIso = this.collectAffectedIso(locations, regionIndex.byId);
    if (affectedIso.size === 0) return;

    const state = await this.loadState();
    this.applySelfLevels(affectedIso, incoming, state.selfByIso);

    await this.recomputeEffective({
      affectedIso,
      regionIndex,
      state,
      incoming,
      at,
    });
  };

  /** Уровень состояния, который привносит тип события (через словарь статусов). */
  private async resolveIncomingLevel(eventType: string): Promise<StateLevel> {
    if (!this.dictLevelByCode) {
      const entries = await this.deps.statusDictionary.listActive();
      this.dictLevelByCode = new Map(entries.map((e) => [e.code, e.stateLevel]));
    }
    return this.dictLevelByCode.get(eventType) ?? "grey";
  }

  /** Индексы регионов: id -> запись и iso -> запись (для соседей и persist). */
  private async buildRegionIndex(): Promise<{
    byId: Map<string, RegionRecord>;
    byIso: Map<string, RegionRecord>;
  }> {
    const regions = await this.deps.regions.listActive();
    const byId = new Map<string, RegionRecord>();
    const byIso = new Map<string, RegionRecord>();
    for (const region of regions) {
      byId.set(region.id, region);
      if (region.iso) byIso.set(region.iso, region);
    }
    return { byId, byIso };
  }

  /** Сигналы в place_status_active: активировать на тревогу, снять на отбой. */
  private async writePlaceStatuses(
    locations: ParsedLocation[],
    statusCode: string,
    incoming: StateLevel,
    at: string,
  ): Promise<void> {
    if (incoming === "green") {
      await this.clearPlaceStatusesOnGreen(locations, at);
      return;
    }

    for (const location of locations) {
      if (!location.placeId) continue;
      await this.deps.placeStatus.upsertActive({
        placeId: location.placeId,
        statusCode,
        source: "parser",
        startedAt: at,
        updatedAt: at,
        meta: {},
      });
    }
  }

  /**
   * Отбой: явные НП — точечно; регион без НП в сообщении — каскад по всем детям.
   */
  private async clearPlaceStatusesOnGreen(
    locations: ParsedLocation[],
    at: string,
  ): Promise<void> {
    const { regionCascadeIds, explicitPlaceIds } = planGreenPlaceStatusClear(locations);

    for (const placeId of explicitPlaceIds) {
      await this.deactivateAllPlaceStatuses(placeId, at);
    }

    for (const regionId of regionCascadeIds) {
      const active = await this.deps.placeStatus.listActiveByRegionId(regionId);
      for (const row of active) {
        await this.deps.placeStatus.deactivate(row.placeId, row.statusCode, at);
      }
    }
  }

  private async deactivateAllPlaceStatuses(placeId: string, at: string): Promise<void> {
    const active = await this.deps.placeStatus.listActive(placeId);
    for (const row of active) {
      await this.deps.placeStatus.deactivate(placeId, row.statusCode, at);
    }
  }

  /** ISO затронутых регионов (по regionId из локаций). */
  private collectAffectedIso(
    locations: ParsedLocation[],
    byId: Map<string, RegionRecord>,
  ): Set<string> {
    const iso = new Set<string>();
    for (const location of locations) {
      const region = byId.get(location.regionId);
      if (region?.iso) iso.add(region.iso);
    }
    return iso;
  }

  /** Текущий срез проекции: selfLevel/effective/activity по ISO. */
  private async loadState(): Promise<{
    selfByIso: Map<string, StateLevel>;
    effectiveByIso: Map<string, StateLevel>;
    activityByIso: Map<string, number>;
  }> {
    const rows = await this.deps.regionState.listAll();
    const selfByIso = new Map<string, StateLevel>();
    const effectiveByIso = new Map<string, StateLevel>();
    const activityByIso = new Map<string, number>();
    for (const row of rows) {
      selfByIso.set(row.regionCode, row.selfLevel);
      effectiveByIso.set(row.regionCode, row.stateLevel);
      activityByIso.set(row.regionCode, row.activity);
    }
    return { selfByIso, effectiveByIso, activityByIso };
  }

  /** Обновляет собственные уровни затронутых регионов по автомату. */
  private applySelfLevels(
    affectedIso: Set<string>,
    incoming: StateLevel,
    selfByIso: Map<string, StateLevel>,
  ): void {
    for (const iso of affectedIso) {
      const current = selfByIso.get(iso) ?? "grey";
      selfByIso.set(iso, computeSelfLevel(current, incoming));
    }
  }

  /** Пересчитывает эффективный уровень затронутых регионов и их соседей. */
  private async recomputeEffective(input: {
    affectedIso: Set<string>;
    regionIndex: { byIso: Map<string, RegionRecord> };
    state: {
      selfByIso: Map<string, StateLevel>;
      effectiveByIso: Map<string, StateLevel>;
      activityByIso: Map<string, number>;
    };
    incoming: StateLevel;
    at: string;
  }): Promise<void> {
    const { affectedIso, regionIndex, state, incoming, at } = input;
    const toRecompute = this.expandWithNeighbors(affectedIso);

    for (const iso of toRecompute) {
      const region = regionIndex.byIso.get(iso);
      if (!region) continue;

      const selfLevel = state.selfByIso.get(iso) ?? "grey";
      const neighborLevels = (this.deps.adjacency[iso] ?? []).map(
        (n) => state.selfByIso.get(n) ?? "grey",
      );
      const effective = computeEffectiveLevel(selfLevel, neighborLevels);
      const previous = state.effectiveByIso.get(iso) ?? "grey";
      if (effective.level === previous) continue;

      const activity = this.nextActivity(
        state.activityByIso.get(iso) ?? 0,
        affectedIso.has(iso),
        incoming,
      );

      await this.deps.regionState.upsert({
        regionId: region.id,
        regionCode: iso,
        stateLevel: effective.level,
        selfLevel,
        activity,
        reason: effective.reason,
        updatedAt: at,
      });
      await this.deps.regionState.appendHistory({
        regionId: region.id,
        regionCode: iso,
        stateLevel: effective.level,
        previousLevel: previous,
        reason: effective.reason,
        changedAt: at,
      });
    }
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

  /** activity: счётчик активности, растёт на тревоге, обнуляется на отбое. */
  private nextActivity(
    current: number,
    isAffected: boolean,
    incoming: StateLevel,
  ): number {
    if (isAffected && incoming === "green") return 0;
    if (isAffected) return current + 1;
    return current;
  }
}
