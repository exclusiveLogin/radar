import type { Subject } from "rxjs";
import { combineLatest, debounceTime } from "rxjs";
import { filter, startWith, switchMap } from "rxjs/operators";
import { mapApi } from "../../shared/api/mapApi";
import {
  hasActiveHeatmapEventTypesFilter,
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
): import("rxjs").Observable<FetchPhase<HeatmapFetchData>> {
  return combineLatest([
    geoMapLayers$,
    heatmapPeriod$,
    historicalAsOf$,
    heatmapEventTypesFilter$,
    signals.heatmapManualRefresh$.pipe(startWith(undefined)),
  ]).pipe(
    filter(([layers, , , filterTypes]) =>
      layers.heatmap && hasActiveHeatmapEventTypesFilter(filterTypes),
    ),
    debounceTime(400),
    switchMap(([, period, until, filterTypes]) =>
      toFetchPhase$(() =>
        mapApi.eventsHeatmap({
          period,
          until: until ?? new Date().toISOString(),
          eventTypes: resolveHeatmapEventTypesQuery(filterTypes),
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
