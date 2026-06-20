import { BehaviorSubject } from "rxjs";
import {
  EVENT_HEATMAP_FILTER_TYPES,
  type EventHeatmapFilterType,
  type EventHeatmapMeta,
  type EventHeatmapPeriod,
} from "@radar/shared";

/** Период live-polling теплокарты (пока слой включён; replay — только по смене asOf). */
export const HEATMAP_LIVE_POLL_MS = 15_000;

/** Пресет окна выборки событий. */
export const heatmapPeriod$ = new BehaviorSubject<EventHeatmapPeriod>("24h");

/** Мета последней успешной выборки (count, since/until). */
export const heatmapMeta$ = new BehaviorSubject<EventHeatmapMeta | null>(null);

/** Режим «все» — без фильтра API; custom — выбранные типы (multi-toggle). */
export type HeatmapEventTypesFilter =
  | { mode: "all" }
  | { mode: "custom"; types: Set<EventHeatmapFilterType> };

export const HEATMAP_EVENT_TYPES_FILTER_ALL: HeatmapEventTypesFilter = { mode: "all" };

export const heatmapEventTypesFilter$ = new BehaviorSubject<HeatmapEventTypesFilter>(
  HEATMAP_EVENT_TYPES_FILTER_ALL,
);

export function setHeatmapPeriod(period: EventHeatmapPeriod): void {
  heatmapPeriod$.next(period);
}

export function setHeatmapMeta(meta: EventHeatmapMeta | null): void {
  heatmapMeta$.next(meta);
}

/** Активен режим «все типы». */
export function isHeatmapEventTypesAllEnabled(
  filter = heatmapEventTypesFilter$.value,
): boolean {
  return filter.mode === "all";
}

/** Есть что показывать: «все» или хотя бы один тип в custom. */
export function hasActiveHeatmapEventTypesFilter(
  filter = heatmapEventTypesFilter$.value,
): boolean {
  return filter.mode === "all" || filter.types.size > 0;
}

/** Toggle «все»: вкл — гасит остальные; выкл — custom без типов. */
export function toggleHeatmapEventTypesAll(): void {
  const filter = heatmapEventTypesFilter$.value;
  if (filter.mode === "all") {
    heatmapEventTypesFilter$.next({ mode: "custom", types: new Set() });
    return;
  }
  heatmapEventTypesFilter$.next(HEATMAP_EVENT_TYPES_FILTER_ALL);
}

/** Клик по типу: гасит «все», переключает тип в custom. */
export function toggleHeatmapEventType(type: EventHeatmapFilterType): void {
  const filter = heatmapEventTypesFilter$.value;
  const types =
    filter.mode === "custom"
      ? new Set(filter.types)
      : new Set<EventHeatmapFilterType>();

  if (types.has(type)) {
    types.delete(type);
  } else {
    types.add(type);
  }
  heatmapEventTypesFilter$.next({ mode: "custom", types });
}

/**
 * Типы для query API: undefined — режим «все» (параметр не шлём).
 * Иначе — явный список выбранных типов.
 */
export function resolveHeatmapEventTypesQuery(
  filter = heatmapEventTypesFilter$.value,
): EventHeatmapFilterType[] | undefined {
  if (filter.mode === "all") return undefined;
  return EVENT_HEATMAP_FILTER_TYPES.filter((type) => filter.types.has(type));
}
