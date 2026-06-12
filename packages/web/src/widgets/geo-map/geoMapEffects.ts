import type { Map as MapLibreMap } from "maplibre-gl";
import type { MutableRefObject } from "react";
import {
  combineLatest,
  debounce,
  debounceTime,
  EMPTY,
  from,
  type Observable,
  switchMap,
  takeUntil,
  timer,
} from "rxjs";
import type { Subject } from "rxjs";
import { catchError, filter, finalize, map, skip, startWith, tap } from "rxjs/operators";
import { mapApi } from "../../shared/api/mapApi";
import { EVENTS_HEATMAP_SOURCE } from "../../shared/config/mapConfig.service";
import { heatmapPeriod$, setHeatmapLoading, setHeatmapMeta } from "../../shared/state/heatmapStore";
import { geoMapLayers$, type GeoMapLayerId } from "../../shared/state/mapLayerStore";
import { historicalAsOf$, placesById$, regionsByCode$ } from "../../shared/state/mapStore";
import type { GeoMapRuntime } from "./geoMapRuntime";
import type { GeoJsonCollection } from "./geoMapTypes";

/**
 * Контекст эффектов карты — только данные/колбэки, без подписок.
 * Подписка и takeUntil(destroy$) — в lifecycle GeoMapWidget (аналог ngOnInit/ngOnDestroy).
 */
export type GeoMapEffectContext = {
  resetRegionsDebounce$: Subject<void>;
  heatmapManualRefresh$: Subject<void>;
  runtime: GeoMapRuntime;
  getMap(): MapLibreMap | null;
  isDisposed(): boolean;
  baseRegionsRef: MutableRefObject<GeoJsonCollection | null>;
  applyPlacesFadeLayers(): void;
  syncGeoOverlayLayers(
    map: MapLibreMap,
    layers: Record<GeoMapLayerId, boolean>,
  ): void;
  hideEventsHeatmap(): void;
};

/** regionsByCode$ → debounce 300 ms; skip(1) — первичная загрузка на map.load. */
export function regionsRefresh$(ctx: GeoMapEffectContext): Observable<void> {
  return regionsByCode$.pipe(
    skip(1),
    debounce(() => timer(300).pipe(takeUntil(ctx.resetRegionsDebounce$))),
    map(() => undefined),
  );
}

/** placesById$ → 120 ms repaint + 500 ms HTTP districts-active. */
export function placesDistrictsGeoJson$(
  ctx: GeoMapEffectContext,
): Observable<unknown> {
  return placesById$.pipe(
    skip(1),
    debounceTime(120),
    tap(() => {
      if (!ctx.isDisposed()) ctx.applyPlacesFadeLayers();
    }),
    switchMap(() =>
      timer(500).pipe(
        switchMap(() =>
          from(mapApi.activeDistrictsGeoJson()).pipe(
            catchError((err: unknown) => {
              console.error("[GeoMapWidget] districts-active-geojson", err);
              return EMPTY;
            }),
          ),
        ),
      ),
    ),
  );
}

/** Теплокарта: layers + period + asOf + manual refresh → debounce 400 ms → HTTP. */
export function eventsHeatmap$(ctx: GeoMapEffectContext): Observable<void> {
  return combineLatest([
    geoMapLayers$,
    heatmapPeriod$,
    historicalAsOf$,
    ctx.heatmapManualRefresh$.pipe(startWith(undefined)),
  ]).pipe(
    filter(([layers]) => layers.heatmap),
    debounceTime(400),
    switchMap(([, period, until]) => {
      if (ctx.isDisposed() || !ctx.getMap()) return EMPTY;
      setHeatmapLoading(true);
      const untilIso = until ?? new Date().toISOString();
      return from(mapApi.eventsHeatmap({ period, until: untilIso })).pipe(
        tap((data) => {
          if (ctx.isDisposed() || !ctx.getMap() || !geoMapLayers$.value.heatmap) return;
          setHeatmapMeta(data.meta);
          ctx.runtime.sources.apply(EVENTS_HEATMAP_SOURCE, {
            type: "FeatureCollection",
            features: data.features,
          });
          const map = ctx.getMap();
          if (map) ctx.syncGeoOverlayLayers(map, geoMapLayers$.value);
        }),
        catchError((error: unknown) => {
          console.error("[GeoMapWidget] events-heatmap", error);
          return EMPTY;
        }),
        finalize(() => {
          if (!ctx.isDisposed()) setHeatmapLoading(false);
        }),
        map(() => undefined),
      );
    }),
  );
}

/** Видимость оверлеев по mapLayerStore — без debounce. */
export function geoMapLayersVisibility$(): Observable<Record<GeoMapLayerId, boolean>> {
  return geoMapLayers$;
}
