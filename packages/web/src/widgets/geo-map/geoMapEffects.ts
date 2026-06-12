import {
  combineLatest,
  debounce,
  debounceTime,
  merge,
  type Observable,
  switchMap,
  timer,
} from "rxjs";
import type { Subject } from "rxjs";
import { filter, map, skip, startWith, takeUntil } from "rxjs/operators";
import { mapApi } from "../../shared/api/mapApi";
import { heatmapPeriod$ } from "../../shared/state/heatmapStore";
import { geoMapLayers$ } from "../../shared/state/mapLayerStore";
import { historicalAsOf$, placesById$, regionsByCode$ } from "../../shared/state/mapStore";
import type {
  DistrictsFetchData,
  FetchPhase,
  HeatmapFetchData,
  RegionsGeometryFetchData,
} from "./geoMapEffectTypes";
import {
  type FetchStreams,
  shareTrigger,
  splitFetchPhase$,
  toFetchPhase$,
} from "./geoMapRx";

/** Императивные сигналы lifecycle карты. */
export type GeoMapEffectSignals = {
  /** Один раз на map.load — стартовые HTTP без skip/debounce. */
  bootstrap$: Subject<void>;
  resetRegionsDebounce$: Subject<void>;
  heatmapManualRefresh$: Subject<void>;
};

/** Доступ к ref'ам из pipe (нужен filter «есть ли геометрия»). */
export type GeoMapEffectHost = {
  signals: GeoMapEffectSignals;
  hasRegionsGeometry(): boolean;
};

/** SSOT: placesById$ → debounce 120 ms (один раз на все производные). */
export function placesStoreTick$(): Observable<void> {
  return shareTrigger(
    placesById$.pipe(
      skip(1),
      debounceTime(120),
      map(() => undefined),
    ),
  );
}

/** SSOT: regionsByCode$ → debounce 300 ms. */
export function regionsStoreTick$(signals: GeoMapEffectSignals): Observable<void> {
  return shareTrigger(
    regionsByCode$.pipe(
      skip(1),
      debounce(() => timer(300).pipe(takeUntil(signals.resetRegionsDebounce$))),
      map(() => undefined),
    ),
  );
}

function fetchRegionsGeometry(): Promise<RegionsGeometryFetchData> {
  return mapApi.regionsGeoJson().then((layer) => layer as RegionsGeometryFetchData);
}

function fetchDistrictsGeometry(): Promise<DistrictsFetchData> {
  return mapApi.activeDistrictsGeoJson().then((layer) => layer as DistrictsFetchData);
}

/** HTTP контуров регионов: bootstrap + store tick без геометрии. */
function regionsGeometryFetchPhase$(host: GeoMapEffectHost): Observable<FetchPhase<RegionsGeometryFetchData>> {
  return merge(
    host.signals.bootstrap$.pipe(switchMap(() => toFetchPhase$(fetchRegionsGeometry))),
    regionsStoreTick$(host.signals).pipe(
      filter(() => !host.hasRegionsGeometry()),
      switchMap(() => toFetchPhase$(fetchRegionsGeometry)),
    ),
  );
}

/** HTTP districts: bootstrap сразу + places tick через 500 ms. */
function districtsFetchPhase$(signals: GeoMapEffectSignals): Observable<FetchPhase<DistrictsFetchData>> {
  return merge(
    signals.bootstrap$.pipe(switchMap(() => toFetchPhase$(fetchDistrictsGeometry))),
    placesStoreTick$().pipe(
      switchMap(() => timer(500).pipe(switchMap(() => toFetchPhase$(fetchDistrictsGeometry)))),
    ),
  );
}

function heatmapFetchPhase$(signals: GeoMapEffectSignals): Observable<FetchPhase<HeatmapFetchData>> {
  return combineLatest([
    geoMapLayers$,
    heatmapPeriod$,
    historicalAsOf$,
    signals.heatmapManualRefresh$.pipe(startWith(undefined)),
  ]).pipe(
    filter(([layers]) => layers.heatmap),
    debounceTime(400),
    switchMap(([, period, until]) =>
      toFetchPhase$(() =>
        mapApi.eventsHeatmap({
          period,
          until: until ?? new Date().toISOString(),
        }),
      ),
    ),
  );
}

export type GeoMapFetchBundle = {
  regions: FetchStreams<RegionsGeometryFetchData>;
  districts: FetchStreams<DistrictsFetchData>;
  heatmap: FetchStreams<HeatmapFetchData>;
};

/** Все HTTP-потоки карты: loading / data / error на слой. */
export function createGeoMapFetchStreams(host: GeoMapEffectHost): GeoMapFetchBundle {
  return {
    regions: splitFetchPhase$(regionsGeometryFetchPhase$(host)),
    districts: splitFetchPhase$(districtsFetchPhase$(host.signals)),
    heatmap: splitFetchPhase$(heatmapFetchPhase$(host.signals)),
  };
}
