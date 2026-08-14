import { BehaviorSubject, timer } from "rxjs";
import { filter } from "rxjs/operators";
import {
  isPlaceSuppressedByRegionClear,
  type MapPlaceSnapshot,
  type MapRegionSnapshot,
  type MapVicinityScopeSnapshot,
  type PlaceStateEvent,
  type RegionStateEvent,
  type Warning,
  type WsServerMessage,
} from "@radar/shared";
import { mapApi } from "../api/mapApi";
import { connectMapWs } from "../realtime/ws";
import { reportAppError } from "./appLogStore";
import { isRegionVisibleOnMap } from "./derivations";
import { bumpTracksRevision } from "./trackStore";

/** Состояние регионов по regionCode (ISO) — источник для всех карт-виджетов. */
export const regionsByCode$ = new BehaviorSubject<Map<string, MapRegionSnapshot>>(
  new Map(),
);

/** Активные места с координатами (гео-слой places). */
export const placesById$ = new BehaviorSubject<Map<string, MapPlaceSnapshot>>(
  new Map(),
);

/** Vicinity scope кольца (point + radiusM). */
export const vicinityScopesById$ = new BehaviorSubject<Map<string, MapVicinityScopeSnapshot>>(
  new Map(),
);

/** Лента смен состояния (region_state_history + WS warning). */
export const stateChanges$ = new BehaviorSubject<Warning[]>([]);

/** Время последнего полученного снапшота (ISO). */
export const lastSnapshotAt$ = new BehaviorSubject<string | null>(null);

/** Маркер исторического просмотра; live WS игнорируется пока !== null. */
export const historicalAsOf$ = new BehaviorSubject<string | null>(null);

/** true пока mapLiveReplayEffects грузит fold-state (scrub / live-return). */
export const mapHistoricalLoading$ = new BehaviorSubject(false);

/**
 * SSOT якоря времени для fade/visibility (мс).
 * replay → asOf; live → Date.now(), обновляется тиком в startMapStore.
 */
export const mapViewAnchor$ = new BehaviorSubject<number>(Date.now());

export function isHistoricalMapView(): boolean {
  return historicalAsOf$.value !== null;
}

/**
 * Коды регионов, чей yellow получен по соседству с red, а не из собственных
 * фактов (`levelReason: "neighbor-red"` из снапшота). Используется тултипами
 * и деталь-панелью, чтобы не выдавать подсветку за собственное событие.
 */
export const derivedRegionCodes$ = new BehaviorSubject<Set<string>>(new Set());

/**
 * Справочник имён регионов по ISO-коду (SSOT — /api/geo/regions).
 * Нужен, чтобы производно «проявившийся» регион получил человекочитаемое имя,
 * а не ISO-код в попапе (фолбэк на код — только если имя реально неизвестно).
 */
let regionNamesByCode: Map<string, string> = new Map();

let started = false;

/** Хук перед установкой asOf (подгонка окна таймлайна). */
let beforeHistoricalSetHook: ((iso: string) => void) | null = null;

export function registerBeforeHistoricalSet(hook: (iso: string) => void): void {
  beforeHistoricalSetHook = hook;
}

/** Якорь времени для visibility/fade: replay → asOf, иначе now. */
export function resolveMapViewAnchorMs(): number {
  const asOf = historicalAsOf$.value;
  if (!asOf) return Date.now();
  const ms = Date.parse(asOf);
  return Number.isFinite(ms) ? ms : Date.now();
}

function refreshMapViewAnchor(): void {
  mapViewAnchor$.next(resolveMapViewAnchorMs());
}

/** Установить asOf — REST загрузка в mapLiveReplayEffects (switchMap). */
export function setHistoricalAsOf(iso: string | null): void {
  if (iso === historicalAsOf$.value) return;
  if (iso) beforeHistoricalSetHook?.(iso);
  historicalAsOf$.next(iso);
}

/** @deprecated используй setHistoricalAsOf */
export function loadHistoricalSnapshot(asOf: string): void {
  setHistoricalAsOf(asOf);
}

/** Вернуться к live-карте. */
export function clearHistoricalView(): void {
  setHistoricalAsOf(null);
}

/** Применить REST-снапшот (mapLiveReplayEffects / ручной refetch). */
export function applyMapSnapshot(
  regions: MapRegionSnapshot[],
  places: MapPlaceSnapshot[],
  generatedAt?: string,
  vicinityScopes: MapVicinityScopeSnapshot[] = [],
): void {
  seedSnapshot(regions, places, generatedAt, vicinityScopes);
}

/** Однократная инициализация: REST-снапшот + подписка на WS-дельты. */
export function startMapStore(): void {
  if (started) return;
  started = true;

  historicalAsOf$.subscribe(() => refreshMapViewAnchor());
  timer(60_000, 60_000)
    .pipe(filter(() => historicalAsOf$.value === null))
    .subscribe(() => refreshMapViewAnchor());

  // WS snapshot отдаёт places=[] (только регионы), а /api/map/snapshot медленный —
  // места тянем отдельным быстрым запросом.
  void loadPlacesState();

  // Однократно грузим справочник имён регионов — SSOT для имени производного региона
  void mapApi.geoRegions()
    .then((regions) => {
      regionNamesByCode = new Map(regions.map((region) => [region.regionCode, region.name]));
    })
    .catch(reportError);

  connectMapWs().subscribe({
    next: applyMessage,
    error: reportError,
  });

  void mapApi.warnings().then((items) => stateChanges$.next(items)).catch(reportError);
}

/** Загружает активные места и подрезает их по текущему состоянию регионов. */
async function loadPlacesState(): Promise<void> {
  if (historicalAsOf$.value !== null) return;
  try {
    const response = await mapApi.placesState();
    const raw = new Map(response.places.map((place) => [place.placeId, place]));
    placesById$.next(prunePlacesForRegions(raw, regionsByCode$.value));
  } catch (error) {
    reportError(error);
  }
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
  const viewNow = resolveMapViewAnchorMs();
  const next = new Map<string, MapPlaceSnapshot>();
  for (const place of places.values()) {
    const region = regions.get(place.regionCode);
    if (!region || !isRegionVisibleOnMap(region, viewNow) || place.stateLevel === "grey") continue;
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

/** Убирает vicinity-кольца в grey-регионах и под более свежим региональным clear. */
function pruneVicinityScopesForRegions(
  scopes: Map<string, MapVicinityScopeSnapshot>,
  regions: Map<string, MapRegionSnapshot>,
): Map<string, MapVicinityScopeSnapshot> {
  const viewNow = resolveMapViewAnchorMs();
  const next = new Map<string, MapVicinityScopeSnapshot>();
  for (const scope of scopes.values()) {
    if (scope.stateLevel === "grey") continue;
    const region = regions.get(scope.regionCode);
    if (!region || !isRegionVisibleOnMap(region, viewNow)) continue;
    if (
      isPlaceSuppressedByRegionClear({
        placeStatusEventAt: scope.statusEventAt,
        regionStatusEventAt: region.statusEventAt,
        regionAction: region.statusAction,
      })
    ) {
      continue;
    }
    next.set(scope.scopeId, scope);
  }
  return next;
}

/** Коды регионов с подсветкой от красного соседа (read-side пометка бэкенда). */
function collectDerivedCodes(regions: Map<string, MapRegionSnapshot>): Set<string> {
  const derived = new Set<string>();
  for (const [code, region] of regions) {
    if (region.levelReason === "neighbor-red") derived.add(code);
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
      || region.statusCode !== other.statusCode
      || region.traits?.mass !== other.traits?.mass
      || region.traits?.uncertain !== other.traits?.uncertain
      || region.centroidLat !== other.centroidLat
      || region.centroidLon !== other.centroidLon
      || region.levelReason !== other.levelReason
    ) {
      return false;
    }
  }
  return true;
}

function seedSnapshot(
  regions: MapRegionSnapshot[],
  places: MapPlaceSnapshot[],
  generatedAt?: string,
  vicinityScopes: MapVicinityScopeSnapshot[] = [],
): void {
  const nextRegions = new Map<string, MapRegionSnapshot>();
  for (const region of regions) nextRegions.set(region.regionCode, region);
  derivedRegionCodes$.next(collectDerivedCodes(nextRegions));
  regionsByCode$.next(nextRegions);

  const rawPlaces = new Map<string, MapPlaceSnapshot>();
  for (const place of places) rawPlaces.set(place.placeId, place);
  placesById$.next(prunePlacesForRegions(rawPlaces, nextRegions));

  const rawScopes = new Map<string, MapVicinityScopeSnapshot>();
  for (const scope of vicinityScopes) rawScopes.set(scope.scopeId, scope);
  vicinityScopesById$.next(pruneVicinityScopesForRegions(rawScopes, nextRegions));

  lastSnapshotAt$.next(generatedAt ?? new Date().toISOString());
}

/** WS seed regions-only (layered transport): не затираем places из REST / place-state. */
function applyRegionsSnapshotOnly(
  regions: MapRegionSnapshot[],
  generatedAt?: string,
): void {
  const nextRegions = new Map<string, MapRegionSnapshot>();
  for (const region of regions) nextRegions.set(region.regionCode, region);
  derivedRegionCodes$.next(collectDerivedCodes(nextRegions));
  regionsByCode$.next(nextRegions);

  const pruned = prunePlacesForRegions(placesById$.value, nextRegions);
  if (pruned !== placesById$.value) {
    placesById$.next(pruned);
  }

  lastSnapshotAt$.next(generatedAt ?? new Date().toISOString());

  // Условие size===0: избегаем повторных fetch при обычных WS-обновлениях регионов.
  if (placesById$.value.size === 0) {
    void loadPlacesState();
  }
}

function applyMessage(message: WsServerMessage): void {
  if (historicalAsOf$.value !== null) return;
  if (message.type === "snapshot") {
    const places = message.payload.places ?? [];
    const scopes = message.payload.vicinityScopes ?? [];
    if (places.length > 0 || scopes.length > 0) {
      seedSnapshot(message.payload.regions, places, message.payload.generatedAt, scopes);
    } else {
      applyRegionsSnapshotOnly(message.payload.regions, message.payload.generatedAt);
    }
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
    return;
  }
  if (message.type === "tracks-updated") {
    bumpTracksRevision();
  }
}

/**
 * Обновляет уровень/activity региона, сохраняя метаданные (name/layout/centroid).
 * Если регион новый (нет layout из предыдущего snapshot), планируем дозагрузку snapshot.
 */
function applyRegionState(event: RegionStateEvent): void {
  const next = new Map(regionsByCode$.value);
  const existing = next.get(event.regionCode);
  const layout = event.layout ?? existing?.layout;
  const calm = event.stateLevel === "grey" || event.stateLevel === "green";
  const updated: MapRegionSnapshot = {
    regionId: event.regionId,
    regionCode: event.regionCode,
    name: existing?.name ?? regionNamesByCode.get(event.regionCode) ?? event.regionCode,
    stateLevel: event.stateLevel,
    activity: event.activity,
    layout,
    centroidLat: event.centroidLat ?? existing?.centroidLat,
    centroidLon: event.centroidLon ?? existing?.centroidLon,
    statusEventAt: event.statusEventAt ?? existing?.statusEventAt,
    statusAction: event.statusAction ?? existing?.statusAction,
    statusCode: event.statusCode ?? (calm ? undefined : existing?.statusCode),
    traits: event.traits ?? (calm ? undefined : existing?.traits),
    eventSubject: event.eventSubject ?? (calm ? undefined : existing?.eventSubject),
    levelReason: event.levelReason,
  };
  if (
    existing
    && existing.stateLevel === updated.stateLevel
    && existing.levelReason === updated.levelReason
    && existing.activity === updated.activity
    && existing.statusEventAt === updated.statusEventAt
    && existing.statusAction === updated.statusAction
    && existing.statusCode === updated.statusCode
    && existing.traits?.mass === updated.traits?.mass
    && existing.traits?.uncertain === updated.traits?.uncertain
    && existing.eventSubject === updated.eventSubject
    && existing.centroidLat === updated.centroidLat
    && existing.centroidLon === updated.centroidLon
  ) {
    return;
  }
  next.set(event.regionCode, updated);
  if (isSameRegionSnapshotMap(next, regionsByCode$.value)) {
    return;
  }
  derivedRegionCodes$.next(collectDerivedCodes(next));
  regionsByCode$.next(next);
  const pruned = prunePlacesForRegions(placesById$.value, next);
  if (pruned !== placesById$.value) {
    placesById$.next(pruned);
  }
  const prunedScopes = pruneVicinityScopesForRegions(vicinityScopesById$.value, next);
  if (prunedScopes !== vicinityScopesById$.value) {
    vicinityScopesById$.next(prunedScopes);
  }
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
  const viewNow = resolveMapViewAnchorMs();
  if (!region || !isRegionVisibleOnMap(region, viewNow)) {
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
  reportAppError("Карта", error);
}

