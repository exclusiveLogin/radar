import {
  combineLatest,
  debounce,
  debounceTime,
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
import type { FetchPhase, DistrictsFetchData, HeatmapFetchData } from "./geoMapEffectTypes";
import { splitFetchPhase$, toFetchPhase$ } from "./geoMapRx";

/** Императивные сигналы, пробивающие reactive-слой (selection, manual refresh). */
export type GeoMapEffectSignals = {
  resetRegionsDebounce$: Subject<void>;
  heatmapManualRefresh$: Subject<void>;
};

/** regionsByCode$ → debounce 300 ms; skip(1) — первичная загрузка на map.load. */
export function regionsRefresh$(signals: GeoMapEffectSignals): Observable<void> {
  return regionsByCode$.pipe(
    skip(1),
    debounce(() => timer(300).pipe(takeUntil(signals.resetRegionsDebounce$))),
    map(() => undefined),
  );
}

/** placesById$ → debounce 120 ms — тик перерисовки маркеров (без HTTP). */
export function placesFadeTick$(): Observable<void> {
  return placesById$.pipe(
    skip(1),
    debounceTime(120),
    map(() => undefined),
  );
}

/** Базовый HTTP districts-active после debounce places (120 + 500 ms). */
function districtsFetchPhase$(): Observable<FetchPhase<DistrictsFetchData>> {
  return placesById$.pipe(
    skip(1),
    debounceTime(120),
    switchMap(() =>
      timer(500).pipe(
        switchMap(() =>
          toFetchPhase$(() =>
            mapApi.activeDistrictsGeoJson().then((layer) => layer as DistrictsFetchData),
          ),
        ),
      ),
    ),
  );
}

/** Districts: loading / data / error — отдельные потоки. */
export function createDistrictsFetchStreams(): {
  loading$: Observable<boolean>;
  data$: Observable<DistrictsFetchData>;
  error$: Observable<unknown>;
} {
  return splitFetchPhase$(districtsFetchPhase$());
}

/** Триггер запроса теплокарты (без HTTP). */
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

/** Heatmap: loading / data / error — отдельные потоки. */
export function createHeatmapFetchStreams(signals: GeoMapEffectSignals): {
  loading$: Observable<boolean>;
  data$: Observable<HeatmapFetchData>;
  error$: Observable<unknown>;
} {
  return splitFetchPhase$(heatmapFetchPhase$(signals));
}
