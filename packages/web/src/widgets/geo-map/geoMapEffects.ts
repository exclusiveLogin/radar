import type { Observable, Subject } from "rxjs";
import { combineLatest, EMPTY, merge, timer } from "rxjs";
import { debounceTime, startWith, switchMap } from "rxjs/operators";
import { mapApi } from "../../shared/api/mapApi";
import {
  hasActiveHeatmapEventTypesFilter,
  HEATMAP_LIVE_POLL_MS,
  heatmapEventTypesFilter$,
  heatmapPeriod$,
  resolveHeatmapEventTypesQuery,
} from "../../shared/state/heatmapStore";
import { geoMapLayers$ } from "../../shared/state/mapLayerStore";
import { historicalAsOf$ } from "../../shared/state/mapStore";
import type {
  DistrictsFetchData,
  FetchPhase,
  HeatmapFetchData,
  RegionsGeometryFetchData,
} from "./geoMapEffectTypes";
import { districtsGeoFetch$, regionsGeoFetch$ } from "../../shared/state/mapGeoPipeline";
import {
  type FetchStreams,
  splitFetchPhase$,
  toFetchPhase$,
} from "./geoMapRx";

export type GeoMapEffectSignals = {
  heatmapManualRefresh$: Subject<void>;
};

function heatmapFetchPhase$(
  signals: GeoMapEffectSignals,
): Observable<FetchPhase<HeatmapFetchData>> {
  return combineLatest([
    geoMapLayers$,
    heatmapPeriod$,
    historicalAsOf$,
    heatmapEventTypesFilter$,
    signals.heatmapManualRefresh$.pipe(startWith(undefined)),
  ]).pipe(
    debounceTime(400),
    switchMap(([layers, period, until, filterTypes]) => {
      if (!layers.heatmap || !hasActiveHeatmapEventTypesFilter(filterTypes)) {
        return EMPTY;
      }

      const fetchHeatmap = () =>
        toFetchPhase$(() =>
          mapApi.eventsHeatmap({
            period,
            until: until ?? new Date().toISOString(),
            eventTypes: resolveHeatmapEventTypesQuery(filterTypes),
          }),
        );

      // Live: сразу + poll каждые N с; replay — только при смене asOf/фильтров.
      const livePoll$ =
        until === null
          ? timer(HEATMAP_LIVE_POLL_MS, HEATMAP_LIVE_POLL_MS).pipe(
              switchMap(() => fetchHeatmap()),
            )
          : EMPTY;

      // fetchHeatmap() холодный (HTTP в toFetchPhase$ на subscribe) — defer не обязателен.
      return merge(fetchHeatmap(), livePoll$);
    }),
  );
}

export type GeoMapFetchBundle = {
  regions: FetchStreams<RegionsGeometryFetchData>;
  districts: FetchStreams<DistrictsFetchData>;
  heatmap: FetchStreams<HeatmapFetchData>;
};

/** HTTP-потоки карты: regions/districts из mapGeoPipeline, heatmap — отдельно. */
export function createGeoMapFetchStreams(
  signals: GeoMapEffectSignals,
): GeoMapFetchBundle {
  return {
    regions: splitFetchPhase$(regionsGeoFetch$()),
    districts: splitFetchPhase$(districtsGeoFetch$()),
    heatmap: splitFetchPhase$(heatmapFetchPhase$(signals)),
  };
}
