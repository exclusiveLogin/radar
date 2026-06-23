/**
 * Rx-пайплайн карты: триггеры (store) → модификаторы (pipe) → потоки paint/fetch.
 */
import { BehaviorSubject, combineLatest, type Observable } from "rxjs";
import { debounceTime, distinctUntilChanged, exhaustMap, filter, map, switchMap } from "rxjs/operators";
import type { MapPlaceSnapshot, MapRegionSnapshot } from "@radar/shared";
import {
  activeDistrictIdsFingerprint,
  visibleRegionCodesFingerprint,
} from "./derivations";
import { geoGeometryRevision$ } from "./geoGeometryStore";
import { geoMapLayers$ } from "./mapLayerStore";
import {
  historicalAsOf$,
  mapViewAnchor$,
  placesById$,
  regionsByCode$,
} from "./mapStore";
import type {
  DistrictsFetchData,
  FetchPhase,
  RegionsGeometryFetchData,
} from "../../widgets/geo-map/geoMapEffectTypes";
import { toFetchPhase$ } from "../../widgets/geo-map/geoMapRx";
import {
  syncDistrictGeometry,
  syncVisibleRegionGeometry,
} from "../../widgets/geo-map/geoMapGeometrySync";

/** Lifecycle выставляет true после setupLayers — гейт для paint/fetch. */
export const mapCanvasReady$ = new BehaviorSubject(false);

export function regionsFingerprint(regions: Map<string, MapRegionSnapshot>): string {
  const parts = [...regions.values()].map(
    (r) => `${r.regionCode}:${r.stateLevel}:${r.statusEventAt}`,
  );
  return `${regions.size}|${parts.sort().join(";")}`;
}

export function placesFingerprint(places: Map<string, MapPlaceSnapshot>): string {
  const parts = [...places.values()].map(
    (p) =>
      `${p.placeId}:${p.stateLevel}:${p.statusEventAt}:${p.lat}:${p.lon}:${p.geoFeatureId ?? ""}`,
  );
  return `${places.size}|${parts.sort().join(";")}`;
}

const debouncePaint = debounceTime(50);
const debounceGeo = debounceTime(80);

/** Centroids: только fold-state, без geo HTTP. */
export function placesPaint$(): Observable<void> {
  return combineLatest([
    placesById$.pipe(map(placesFingerprint), distinctUntilChanged()),
    regionsByCode$.pipe(map(regionsFingerprint), distinctUntilChanged()),
    mapViewAnchor$,
    geoMapLayers$.pipe(
      map((layers) => layers.places),
      distinctUntilChanged(),
    ),
    mapCanvasReady$,
  ]).pipe(
    filter(([, , , enabled, ready]) => enabled && ready),
    debouncePaint,
    map(() => undefined),
  );
}

/** Контуры регионов: fold + lazy geo. */
export function regionsPaint$(): Observable<void> {
  return combineLatest([
    regionsByCode$.pipe(map(regionsFingerprint), distinctUntilChanged()),
    geoGeometryRevision$,
    mapViewAnchor$,
    geoMapLayers$.pipe(
      map((layers) => layers.regions),
      distinctUntilChanged(),
    ),
    mapCanvasReady$,
  ]).pipe(
    filter(([, , , enabled, ready]) => enabled && ready),
    debouncePaint,
    map(() => undefined),
  );
}

/** Полигоны районов: geoFeatureId + lazy geo. */
export function districtsPaint$(): Observable<void> {
  return combineLatest([
    placesById$.pipe(map(placesFingerprint), distinctUntilChanged()),
    regionsByCode$.pipe(map(regionsFingerprint), distinctUntilChanged()),
    geoGeometryRevision$,
    geoMapLayers$.pipe(
      map((layers) => layers.districts),
      distinctUntilChanged(),
    ),
    mapCanvasReady$,
  ]).pipe(
    filter(([, , , enabled, ready]) => enabled && ready),
    debouncePaint,
    map(() => undefined),
  );
}

/** Lazy fetch контуров: switchMap отменяет устаревший запрос при смене visible codes. */
export function regionsGeoFetch$(): Observable<FetchPhase<RegionsGeometryFetchData>> {
  return combineLatest([
    combineLatest([regionsByCode$, mapViewAnchor$]).pipe(
      map(([regions, viewNow]) => visibleRegionCodesFingerprint(regions, viewNow)),
      distinctUntilChanged(),
    ),
    historicalAsOf$.pipe(distinctUntilChanged()),
    geoMapLayers$.pipe(
      map((layers) => layers.regions),
      distinctUntilChanged(),
    ),
    mapCanvasReady$,
  ]).pipe(
    filter(([, , enabled, ready]) => enabled && ready),
    debounceGeo,
    switchMap(() => toFetchPhase$(syncVisibleRegionGeometry)),
  );
}

/** Lazy fetch районов: exhaustMap + независимый триггер от regions. */
export function districtsGeoFetch$(): Observable<FetchPhase<DistrictsFetchData>> {
  return combineLatest([
    placesById$.pipe(
      map((places) => activeDistrictIdsFingerprint(places)),
      distinctUntilChanged(),
    ),
    geoMapLayers$.pipe(
      map((layers) => layers.districts),
      distinctUntilChanged(),
    ),
    mapCanvasReady$,
  ]).pipe(
    filter(([, enabled, ready]) => enabled && ready),
    debounceGeo,
    exhaustMap(() => toFetchPhase$(syncDistrictGeometry)),
  );
}
