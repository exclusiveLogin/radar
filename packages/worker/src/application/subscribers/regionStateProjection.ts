import type {
  DomainEvent,
  EventHandler,
  GeoEventCategory,
  IPlaceStatusRepository,
  IRegionRepository,
  IRegionStateRepository,
  IStatusDictionaryRepository,
  LocationPrecision,
  ProvenanceAccumulator,
  RegionRecord,
  StateLevel,
  StatusDictionaryRecord,
} from "@radar/shared";
import {
  PLACE_STATUS_EVENT_AT_META_KEY,
  SOURCE_TRUST,
  isMapEventOlderThanTtl,
  isStaleStatusEvent,
  mergeContribution,
  readPlaceStatusEventAt,
} from "@radar/shared";
import { bridgeEventCategoryToCode } from "../../domain/region-state/eventCategoryBridge.js";
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
  /** LLM-категория события (атрибут-энричер, ADR-003). Fallback к rule-коду. */
  eventCategory?: GeoEventCategory;
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
  /** Окно TTL карты (мс): события старше — не применяем. */
  mapStateTtlMs: number;
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
  private dictionary: StatusDictionaryRecord[] | null = null;

  constructor(private readonly deps: ProjectionDeps) {}

  readonly handler: EventHandler = async (event: DomainEvent): Promise<void> => {
    if (event.type !== "MessageParsed") return;
    const payload = event.payload as MessageParsedPayload;
    const locations = payload.locations ?? [];
    if (locations.length === 0) return;

    await this.ensureDictionary();
    const statusCode = this.resolveEffectiveStatusCode(
      payload.eventType,
      payload.eventCategory,
    );
    const incoming = this.levelOf(statusCode);
    const messageAt = payload.postedAt ?? event.occurredAt;
    if (
      isMapEventOlderThanTtl(messageAt, Date.now(), this.deps.mapStateTtlMs)
    ) {
      return;
    }
    /** Время записи в БД — для WS-поллеров (не postedAt сообщения из бэкфилла). */
    const recordedAt = new Date().toISOString();

    const regionIndex = await this.buildRegionIndex();
    await this.writePlaceStatuses(locations, statusCode, incoming, messageAt, recordedAt);

    const affectedIso = this.collectAffectedIso(locations, regionIndex.byId);
    if (affectedIso.size === 0) return;

    const state = await this.loadState();
    this.applySelfLevels(affectedIso, incoming, messageAt, state);

    await this.recomputeEffective({
      affectedIso,
      regionIndex,
      state,
      incoming,
      messageAt,
      recordedAt,
    });
  };

  /** Лениво грузит активный словарь статусов (code→level + полный список для моста). */
  private async ensureDictionary(): Promise<void> {
    if (this.dictionary) return;
    this.dictionary = await this.deps.statusDictionary.listActive();
    this.dictLevelByCode = new Map(this.dictionary.map((e) => [e.code, e.stateLevel]));
  }

  /** Уровень состояния по коду статуса (grey, если код не из словаря). */
  private levelOf(code: string): StateLevel {
    return this.dictLevelByCode?.get(code) ?? "grey";
  }

  /**
   * Эффективный код статуса: merge rule + LLM (attribute); при равном precision
   * побеждает больший trust (LLM > rule). other → all_clear (снять ложный alarm).
   */
  private resolveEffectiveStatusCode(
    ruleEventType: string,
    eventCategory: GeoEventCategory | undefined,
  ): string {
    const dictionary = this.dictionary ?? [];
    let merged: ProvenanceAccumulator = {};
    if (this.levelOf(ruleEventType) !== "grey") {
      merged = mergeContribution(merged, {
        eventType: {
          value: ruleEventType,
          source: "rule",
          trust: SOURCE_TRUST.rule,
          precision: "attribute",
        },
      });
    }
    const llmCategory: GeoEventCategory | undefined =
      eventCategory === "other" ? "all_clear" : eventCategory;
    const llmCode = llmCategory
      ? bridgeEventCategoryToCode(llmCategory, dictionary)
      : null;
    if (llmCode) {
      merged = mergeContribution(merged, {
        eventType: {
          value: llmCode,
          source: "llm",
          trust: SOURCE_TRUST.llm,
          precision: "attribute",
        },
      });
    }
    return (merged.eventType?.value as string | undefined) ?? ruleEventType;
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
    messageAt: string,
    recordedAt: string,
  ): Promise<void> {
    if (incoming === "green") {
      await this.clearPlaceStatusesOnGreen(locations, messageAt, recordedAt);
      return;
    }

    for (const location of locations) {
      if (!location.placeId) continue;
      await this.deps.placeStatus.upsertActive({
        placeId: location.placeId,
        statusCode,
        source: "parser",
        startedAt: messageAt,
        updatedAt: recordedAt,
        meta: { [PLACE_STATUS_EVENT_AT_META_KEY]: messageAt },
      });
    }
  }

  /**
   * Отбой: явные НП — точечно; регион без НП в сообщении — каскад по всем детям.
   */
  private async clearPlaceStatusesOnGreen(
    locations: ParsedLocation[],
    messageAt: string,
    recordedAt: string,
  ): Promise<void> {
    const { regionCascadeIds, explicitPlaceIds } = planGreenPlaceStatusClear(locations);

    for (const placeId of explicitPlaceIds) {
      await this.deactivateAllPlaceStatuses(placeId, messageAt, recordedAt);
    }

    for (const regionId of regionCascadeIds) {
      const active = await this.deps.placeStatus.listActiveByRegionId(regionId);
      for (const row of active) {
        await this.deactivatePlaceIfNotStale(
          row.placeId,
          row.statusCode,
          messageAt,
          recordedAt,
        );
      }
    }
  }

  private async deactivateAllPlaceStatuses(
    placeId: string,
    messageAt: string,
    recordedAt: string,
  ): Promise<void> {
    const active = await this.deps.placeStatus.listActive(placeId);
    for (const row of active) {
      await this.deactivatePlaceIfNotStale(
        placeId,
        row.statusCode,
        messageAt,
        recordedAt,
      );
    }
  }

  private async deactivatePlaceIfNotStale(
    placeId: string,
    statusCode: string,
    messageAt: string,
    recordedAt: string,
  ): Promise<void> {
    const active = await this.deps.placeStatus.listActive(placeId);
    const row = active.find((entry) => entry.statusCode === statusCode);
    if (row && isStaleStatusEvent(messageAt, readPlaceStatusEventAt(row.meta))) return;
    await this.deps.placeStatus.deactivate(placeId, statusCode, recordedAt);
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

  /** Обновляет собственные уровни затронутых регионов по автомату. */
  private applySelfLevels(
    affectedIso: Set<string>,
    incoming: StateLevel,
    messageAt: string,
    state: {
      selfByIso: Map<string, StateLevel>;
      statusEventAtByIso: Map<string, string>;
    },
  ): void {
    for (const iso of affectedIso) {
      if (isStaleStatusEvent(messageAt, state.statusEventAtByIso.get(iso))) continue;
      const current = state.selfByIso.get(iso) ?? "grey";
      state.selfByIso.set(iso, computeSelfLevel(current, incoming));
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
      statusEventAtByIso: Map<string, string>;
    };
    incoming: StateLevel;
    messageAt: string;
    recordedAt: string;
  }): Promise<void> {
    const { affectedIso, regionIndex, state, incoming, messageAt, recordedAt } = input;
    const toRecompute = this.expandWithNeighbors(affectedIso);

    for (const iso of toRecompute) {
      const region = regionIndex.byIso.get(iso);
      if (!region) continue;
      if (isStaleStatusEvent(messageAt, state.statusEventAtByIso.get(iso))) continue;

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
        updatedAt: recordedAt,
        statusEventAt: messageAt,
      });
      state.statusEventAtByIso.set(iso, messageAt);
      await this.deps.regionState.appendHistory({
        regionId: region.id,
        regionCode: iso,
        stateLevel: effective.level,
        previousLevel: previous,
        reason: effective.reason,
        changedAt: recordedAt,
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
