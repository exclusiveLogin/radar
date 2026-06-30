/**
 * Rx-пайплайн карты: триггеры (store) → модификаторы (pipe) → потоки paint/fetch.
 */
import { BehaviorSubject, combineLatest, type Observable } from "rxjs";
import { debounceTime, distinctUntilChanged, exhaustMap, filter, map, switchMap } from "rxjs/operators";
import type {
  MapPlaceSnapshot,
  MapRegionSnapshot,
  MapVicinityScopeSnapshot,
} from "@radar/shared";
import {
  activeDistrictIdsFingerprint,
  visibleRegionCodesFingerprint,
} from "./derivations";
import { geoGeometryRevision$ } from "./geoGeometryStore";
import { geoMapLayers$ } from "./mapLayerStore";
import {
  historicalAsOf$,
  derivedRegionCodes$,
  mapViewAnchor$,
  placesById$,
  regionsByCode$,
  vicinityScopesById$,
} from "./mapStore";
import { tracksFlow$, tracksGravity$, tracksList$, tracksLoading$, tracksPipelineActive$ } from "./trackStore";
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
    (r) =>
      `${r.regionCode}:${r.stateLevel}:${r.statusEventAt}:${r.statusCode ?? ""}:${r.traits?.mass ? "m" : ""}:${r.traits?.uncertain ? "u" : ""}:${r.centroidLat ?? ""}:${r.centroidLon ?? ""}`,
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

export function vicinityFingerprint(
  scopes: Map<string, MapVicinityScopeSnapshot>,
): string {
  const parts = [...scopes.values()].map(
    (s) =>
      `${s.scopeId}:${s.stateLevel}:${s.statusEventAt ?? ""}:${s.lat}:${s.lon}:${s.radiusM}`,
  );
  return `${scopes.size}|${parts.sort().join(";")}`;
}

const debouncePaint = debounceTime(50);
const debounceGeo = debounceTime(80);

/**
 * ЕДИНЫЙ render-тик карты (SSOT перерисовки).
 *
 * Подписан на ВСЕ источники данных слоёв сразу: fold (регионы/места/около/угрозы),
 * lazy-геометрию (revision), треки и тоглы видимости. Любое изменение любого
 * активного слоя → один debounced emit → один renderActiveLayers() в lifecycle →
 * один кадр со всеми слоями. Это убирает рейсы раздельных setData/repaint, когда
 * каждый слой рендерился в свой тик и кадры мигали частичным состоянием.
 *
 * Сами apply-функции слоёв гейтятся по своему тоглу и fingerprint-skip'ятся, поэтому
 * «применить все» на каждый тик дёшево и идемпотентно.
 */
export function geoRenderTick$(): Observable<void> {
  return combineLatest([
    regionsByCode$.pipe(map(regionsFingerprint), distinctUntilChanged()),
    placesById$.pipe(map(placesFingerprint), distinctUntilChanged()),
    vicinityScopesById$.pipe(map(vicinityFingerprint), distinctUntilChanged()),
    derivedRegionCodes$.pipe(
      map((codes) => [...codes].sort().join(",")),
      distinctUntilChanged(),
    ),
    geoGeometryRevision$.pipe(distinctUntilChanged()),
    tracksList$.pipe(distinctUntilChanged()),
    tracksFlow$.pipe(distinctUntilChanged()),
    tracksGravity$.pipe(distinctUntilChanged()),
    tracksLoading$.pipe(distinctUntilChanged()),
    tracksPipelineActive$.pipe(distinctUntilChanged()),
    geoMapLayers$,
    mapViewAnchor$,
    mapCanvasReady$,
  ]).pipe(
    filter((values) => values[values.length - 1] === true),
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
