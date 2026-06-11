import { BehaviorSubject } from "rxjs";
import {
  isPlaceSuppressedByRegionClear,
  type MapPlaceSnapshot,
  type MapRegionSnapshot,
  type PlaceStateEvent,
  type RegionStateEvent,
  type Warning,
  type WsServerMessage,
} from "@radar/shared";
import { mapApi } from "../api/mapApi";
import { connectMapWs } from "../realtime/ws";
import { deriveNeighborLevels, isRegionVisibleOnMap } from "./derivations";

/** Состояние регионов по regionCode (ISO) — источник для всех карт-виджетов. */
export const regionsByCode$ = new BehaviorSubject<Map<string, MapRegionSnapshot>>(
  new Map(),
);

/** Активные места с координатами (гео-слой places). */
export const placesById$ = new BehaviorSubject<Map<string, MapPlaceSnapshot>>(
  new Map(),
);

/** Лента смен состояния (region_state_history + WS warning). */
export const stateChanges$ = new BehaviorSubject<Warning[]>([]);

/** Время последнего полученного снапшота (ISO). */
export const lastSnapshotAt$ = new BehaviorSubject<string | null>(null);

/**
 * Коды регионов, ставших yellow исключительно по производному правилу соседства
 * (реальный уровень — grey, но сосед red → визуально yellow).
 * Используется тултипами и деталь-панелью.
 */
export const derivedRegionCodes$ = new BehaviorSubject<Set<string>>(new Set());

/** @deprecated используй stateChanges$ */
export const warnings$ = stateChanges$;

/** Смежность регионов — загружается однократно, используется для производного yellow. */
let adjacency: Record<string, string[]> = {};

let started = false;

/** Повторно загрузить snapshot с API (после clear:archive, если WS не пришёл). */
export function refetchMapSnapshot(): Promise<void> {
  return mapApi
    .snapshot()
    .then((snap) => {
      seedSnapshot(snap.regions, snap.places ?? []);
    })
    .catch((err) => {
      reportError(err);
      throw err;
    });
}

/** Однократная инициализация: REST-снапшот + подписка на WS-дельты. */
export function startMapStore(): void {
  if (started) return;
  started = true;

  // Загружаем смежность однократно — нужна для производного yellow у соседей red-регионов
  void mapApi.regionAdjacency()
    .then((adj) => {
      adjacency = adj;
      // Пересчитать соседей если снапшот уже пришёл
      if (regionsByCode$.value.size > 0) {
        const derived = deriveNeighborLevels(regionsByCode$.value, adjacency);
        if (derived !== regionsByCode$.value) regionsByCode$.next(derived);
      }
    })
    .catch(reportError);

  void mapApi
    .snapshot()
    .then((snap) => {
      seedSnapshot(snap.regions, snap.places ?? []);
      connectMapWs().subscribe({
        next: applyMessage,
        // Не даём подписке прерваться на ошибке одного сообщения
        error: reportError,
      });
    })
    .catch(reportError);
  void mapApi.warnings().then((items) => stateChanges$.next(items)).catch(reportError);
}

/** Пропуск emit, если снапшот места не изменился (снижает шторм WS → MapLibre). */
function isSamePlaceSnapshot(a: MapPlaceSnapshot, b: MapPlaceSnapshot): boolean {
  return (
    a.placeId === b.placeId
    && a.regionCode === b.regionCode
    && a.stateLevel === b.stateLevel
    && a.statusCode === b.statusCode
    && a.lat === b.lat
    && a.lon === b.lon
    && a.statusEventAt === b.statusEventAt
    && a.updatedAt === b.updatedAt
  );
}

/** Убирает точки в grey-регионах и под более свежим региональным clear (raise не гасит). */
function prunePlacesForRegions(
  places: Map<string, MapPlaceSnapshot>,
  regions: Map<string, MapRegionSnapshot>,
): Map<string, MapPlaceSnapshot> {
  const next = new Map<string, MapPlaceSnapshot>();
  for (const place of places.values()) {
    const region = regions.get(place.regionCode);
    if (!region || !isRegionVisibleOnMap(region) || place.stateLevel === "grey") continue;
    if (
      isPlaceSuppressedByRegionClear({
        placeStatusEventAt: place.statusEventAt,
        regionStatusEventAt: region.statusEventAt,
        regionAction: region.statusAction,
      })
    ) {
      continue;
    }
    next.set(place.placeId, place);
  }
  return next;
}

/** Извлекает коды регионов, уровень которых изменился в результате производного правила. */
function extractDerivedCodes(
  before: Map<string, MapRegionSnapshot>,
  after: Map<string, MapRegionSnapshot>,
): Set<string> {
  const derived = new Set<string>();
  for (const [code, afterRegion] of after) {
    const beforeRegion = before.get(code);
    if (beforeRegion?.stateLevel === "grey" && afterRegion.stateLevel === "yellow") {
      derived.add(code);
    }
  }
  return derived;
}

/** Сравнение снапшотов регионов без учёта ссылки на Map (меньше шторма WS → MapLibre). */
function isSameRegionSnapshotMap(
  a: Map<string, MapRegionSnapshot>,
  b: Map<string, MapRegionSnapshot>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [code, region] of a) {
    const other = b.get(code);
    if (!other) return false;
    if (
      region.stateLevel !== other.stateLevel
      || region.activity !== other.activity
      || region.statusEventAt !== other.statusEventAt
      || region.statusAction !== other.statusAction
      || region.centroidLat !== other.centroidLat
      || region.centroidLon !== other.centroidLon
    ) {
      return false;
    }
  }
  return true;
}

function seedSnapshot(
  regions: MapRegionSnapshot[],
  places: MapPlaceSnapshot[],
): void {
  const rawRegions = new Map<string, MapRegionSnapshot>();
  for (const region of regions) rawRegions.set(region.regionCode, region);
  const nextRegions = deriveNeighborLevels(rawRegions, adjacency);
  derivedRegionCodes$.next(extractDerivedCodes(rawRegions, nextRegions));
  regionsByCode$.next(nextRegions);

  const rawPlaces = new Map<string, MapPlaceSnapshot>();
  for (const place of places) rawPlaces.set(place.placeId, place);
  placesById$.next(prunePlacesForRegions(rawPlaces, nextRegions));

  lastSnapshotAt$.next(new Date().toISOString());
}

function applyMessage(message: WsServerMessage): void {
  if (message.type === "snapshot") {
    seedSnapshot(message.payload.regions, message.payload.places ?? []);
    return;
  }
  if (message.type === "region-state") {
    applyRegionState(message.payload);
    return;
  }
  if (message.type === "place-state") {
    applyPlaceState(message.payload);
    return;
  }
  if (message.type === "warning") {
    stateChanges$.next([message.payload, ...stateChanges$.value].slice(0, 200));
  }
}

/**
 * Обновляет уровень/activity региона, сохраняя метаданные (name/layout/centroid).
 * Если регион новый (нет layout из предыдущего snapshot), планируем дозагрузку snapshot.
 */
function applyRegionState(event: RegionStateEvent): void {
  const raw = new Map(regionsByCode$.value);
  const existing = raw.get(event.regionCode);
  const layout = event.layout ?? existing?.layout;
  const updated: MapRegionSnapshot = {
    regionId: event.regionId,
    regionCode: event.regionCode,
    name: existing?.name ?? event.regionCode,
    stateLevel: event.stateLevel,
    activity: event.activity,
    layout,
    centroidLat: event.centroidLat ?? existing?.centroidLat,
    centroidLon: event.centroidLon ?? existing?.centroidLon,
    statusEventAt: event.statusEventAt ?? existing?.statusEventAt,
    statusAction: event.statusAction ?? existing?.statusAction,
  };
  if (
    existing
    && existing.stateLevel === updated.stateLevel
    && existing.activity === updated.activity
    && existing.statusEventAt === updated.statusEventAt
    && existing.statusAction === updated.statusAction
    && existing.centroidLat === updated.centroidLat
    && existing.centroidLon === updated.centroidLon
  ) {
    return;
  }
  raw.set(event.regionCode, updated);
  const next = deriveNeighborLevels(raw, adjacency);
  if (isSameRegionSnapshotMap(next, regionsByCode$.value)) {
    return;
  }
  derivedRegionCodes$.next(extractDerivedCodes(raw, next));
  regionsByCode$.next(next);
  const pruned = prunePlacesForRegions(placesById$.value, next);
  if (pruned !== placesById$.value) {
    placesById$.next(pruned);
  }

  // Новый регион без layout → нужен полный snapshot чтобы получить тайл-координаты
  if (!layout) {
    scheduleSnapshotRefetch();
  }
}

/** Дебаунс-таймер для дозагрузки snapshot при появлении регионов без layout. */
let refetchTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSnapshotRefetch(): void {
  if (refetchTimer) return;
  refetchTimer = setTimeout(() => {
    refetchTimer = null;
    void refetchMapSnapshot();
  }, 800);
}

/** Добавляет/обновляет/снимает место на гео-карте по WS place-state. */
function applyPlaceState(event: PlaceStateEvent): void {
  const next = new Map(placesById$.value);

  if (event.action === "deactivate" || event.stateLevel === "grey") {
    next.delete(event.placeId);
    placesById$.next(next);
    return;
  }

  if (event.lat === undefined || event.lon === undefined) return;

  const region = regionsByCode$.value.get(event.regionCode);
  if (!region || !isRegionVisibleOnMap(region)) {
    next.delete(event.placeId);
    placesById$.next(next);
    return;
  }

  // Региональный clear новее place → не показываем точку
  if (
    isPlaceSuppressedByRegionClear({
      placeStatusEventAt: event.changedAt,
      regionStatusEventAt: region.statusEventAt,
      regionAction: region.statusAction,
    })
  ) {
    next.delete(event.placeId);
    placesById$.next(next);
    return;
  }

  const snapshot: MapPlaceSnapshot = {
    placeId: event.placeId,
    placeName: event.placeName,
    regionId: event.regionId,
    regionCode: event.regionCode,
    statusCode: event.statusCode,
    stateLevel: event.stateLevel,
    kind: event.kind,
    geoFeatureId: event.geoFeatureId,
    lat: event.lat,
    lon: event.lon,
    updatedAt: event.changedAt,
    statusEventAt: event.changedAt,
  };
  const prev = next.get(event.placeId);
  if (prev && isSamePlaceSnapshot(prev, snapshot)) {
    return;
  }
  next.set(event.placeId, snapshot);
  placesById$.next(next);
}

function reportError(error: unknown): void {
  console.error("[mapStore]", error);
}

