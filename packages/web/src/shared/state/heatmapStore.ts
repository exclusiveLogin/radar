import { BehaviorSubject } from "rxjs";
import {
  EVENT_HEATMAP_FILTER_TYPES,
  type EventHeatmapFilterType,
  type EventHeatmapMeta,
  type EventHeatmapPeriod,
} from "@radar/shared";
import { readHeatmapPreferences, writeHeatmapPreferences } from "./uiPreferencesStore";

/** Период live-polling теплокарты (пока слой включён; replay — только по смене asOf). */
export const HEATMAP_LIVE_POLL_MS = 15_000;

/** Пресет окна выборки событий. */
export const heatmapPeriod$ = new BehaviorSubject<EventHeatmapPeriod>(readPersistedHeatmapPeriod());

/** Мета последней успешной выборки (count, since/until). */
export const heatmapMeta$ = new BehaviorSubject<EventHeatmapMeta | null>(null);

/** Режим «все» — без фильтра API; custom — выбранные типы (multi-toggle). */
export type HeatmapEventTypesFilter =
  | { mode: "all" }
  | { mode: "custom"; types: Set<EventHeatmapFilterType> };

export const HEATMAP_EVENT_TYPES_FILTER_ALL: HeatmapEventTypesFilter = { mode: "all" };

export const heatmapEventTypesFilter$ = new BehaviorSubject<HeatmapEventTypesFilter>(
  readPersistedHeatmapEventTypesFilter(),
);

function isEventHeatmapPeriod(value: string): value is EventHeatmapPeriod {
  return value === "24h" || value === "7d" || value === "30d" || value === "all";
}

function readPersistedHeatmapPeriod(): EventHeatmapPeriod {
  const raw = readHeatmapPreferences().period;
  return raw && isEventHeatmapPeriod(raw) ? raw : "24h";
}

function readPersistedHeatmapEventTypesFilter(): HeatmapEventTypesFilter {
  const persisted = readHeatmapPreferences();
  if (persisted.filterMode !== "custom") return HEATMAP_EVENT_TYPES_FILTER_ALL;
  const allowed = new Set(EVENT_HEATMAP_FILTER_TYPES);
  const selected = (persisted.filterTypes ?? []).filter((type): type is EventHeatmapFilterType =>
    allowed.has(type as EventHeatmapFilterType),
  );
  return { mode: "custom", types: new Set(selected) };
}

function persistHeatmapFilter(filter: HeatmapEventTypesFilter): void {
  if (filter.mode === "all") {
    writeHeatmapPreferences({ filterMode: "all", filterTypes: [] });
    return;
  }
  writeHeatmapPreferences({
    filterMode: "custom",
    filterTypes: EVENT_HEATMAP_FILTER_TYPES.filter((type) => filter.types.has(type)),
  });
}

export function setHeatmapPeriod(period: EventHeatmapPeriod): void {
  heatmapPeriod$.next(period);
  writeHeatmapPreferences({ period });
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
    const next = { mode: "custom", types: new Set<EventHeatmapFilterType>() } as const;
    heatmapEventTypesFilter$.next(next);
    persistHeatmapFilter(next);
    return;
  }
  heatmapEventTypesFilter$.next(HEATMAP_EVENT_TYPES_FILTER_ALL);
  persistHeatmapFilter(HEATMAP_EVENT_TYPES_FILTER_ALL);
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
  const next = { mode: "custom", types } as const;
  heatmapEventTypesFilter$.next(next);
  persistHeatmapFilter(next);
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
