import { BehaviorSubject } from "rxjs";
import type {
  MapRegionSnapshot,
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
      seedSnapshot(snap.regions);
      // WS только после готовности API — иначе vite-proxy шумит ECONNREFUSED при старте.
      connectMapWs().subscribe(applyMessage);
    })
    .catch(reportError);
  void mapApi.warnings().then((items) => warnings$.next(items)).catch(reportError);
}

function seedSnapshot(regions: MapRegionSnapshot[]): void {
  const next = new Map<string, MapRegionSnapshot>();
  for (const region of regions) next.set(region.regionCode, region);
  regionsByCode$.next(next);
}

function applyMessage(message: WsServerMessage): void {
  if (message.type === "snapshot") {
    seedSnapshot(message.payload.regions);
    return;
  }
  if (message.type === "region-state") {
    applyRegionState(message.payload);
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
    centroidLat: existing?.centroidLat,
    centroidLon: existing?.centroidLon,
  });
  regionsByCode$.next(next);
}

function reportError(error: unknown): void {
  console.error("[mapStore]", error);
}
