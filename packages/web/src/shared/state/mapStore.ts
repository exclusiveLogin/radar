import { BehaviorSubject } from "rxjs";
import type {
  MapPlaceSnapshot,
  MapRegionSnapshot,
  PlaceStateEvent,
  RegionStateEvent,
  Warning,
  WsServerMessage,
} from "@radar/shared";
import { mapApi } from "../api/mapApi";
import { connectMapWs } from "../realtime/ws";

/** Состояние регионов по regionCode (ISO) — источник для всех карт-виджетов. */
export const regionsByCode$ = new BehaviorSubject<Map<string, MapRegionSnapshot>>(
  new Map(),
);

/** Активные места с координатами (гео-слой places). */
export const placesById$ = new BehaviorSubject<Map<string, MapPlaceSnapshot>>(
  new Map(),
);

/** Лента предупреждений (накопительная, новые сверху). */
export const warnings$ = new BehaviorSubject<Warning[]>([]);

let started = false;

/** Однократная инициализация: REST-снапшот + подписка на WS-дельты. */
export function startMapStore(): void {
  if (started) return;
  started = true;

  void mapApi
    .snapshot()
    .then((snap) => {
      seedSnapshot(snap.regions, snap.places ?? []);
      connectMapWs().subscribe(applyMessage);
    })
    .catch(reportError);
  void mapApi.warnings().then((items) => warnings$.next(items)).catch(reportError);
}

function seedSnapshot(
  regions: MapRegionSnapshot[],
  places: MapPlaceSnapshot[],
): void {
  const nextRegions = new Map<string, MapRegionSnapshot>();
  for (const region of regions) nextRegions.set(region.regionCode, region);
  regionsByCode$.next(nextRegions);

  const nextPlaces = new Map<string, MapPlaceSnapshot>();
  for (const place of places) nextPlaces.set(place.placeId, place);
  placesById$.next(nextPlaces);
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
    warnings$.next([message.payload, ...warnings$.value].slice(0, 200));
  }
}

/** Обновляет уровень/activity региона, сохраняя метаданные (name/layout/centroid). */
function applyRegionState(event: RegionStateEvent): void {
  const next = new Map(regionsByCode$.value);
  const existing = next.get(event.regionCode);
  next.set(event.regionCode, {
    regionId: event.regionId,
    regionCode: event.regionCode,
    name: existing?.name ?? event.regionCode,
    stateLevel: event.stateLevel,
    activity: event.activity,
    layout: existing?.layout,
    centroidLat: event.centroidLat ?? existing?.centroidLat,
    centroidLon: event.centroidLon ?? existing?.centroidLon,
  });
  regionsByCode$.next(next);
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

  next.set(event.placeId, {
    placeId: event.placeId,
    placeName: event.placeName,
    regionId: event.regionId,
    regionCode: event.regionCode,
    statusCode: event.statusCode,
    stateLevel: event.stateLevel,
    lat: event.lat,
    lon: event.lon,
    updatedAt: event.changedAt,
  });
  placesById$.next(next);
}

function reportError(error: unknown): void {
  console.error("[mapStore]", error);
}
