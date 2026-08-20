/**
 * Синхронизация данных гео-карты: HTTP-слои, render tick и состояние heatmap.
 *
 * Модуль не управляет MapLibre. Он только соединяет store/effects с callbacks
 * рендера, поэтому один проход `renderActiveLayers` остаётся SSOT покраски.
 */
import type { Subject, Subscription } from "rxjs";
import { takeUntil } from "rxjs";
import {
  hasActiveHeatmapEventTypesFilter,
  heatmapEventTypesFilter$,
} from "../../shared/state/heatmapStore";
import { mapCanvasReady$, geoRenderTick$ } from "../../shared/state/mapGeoPipeline";
import {
  createGeoMapFetchStreams,
  type GeoMapEffectSignals,
} from "./geoMapEffects";
import type { HeatmapFetchData } from "./geoMapEffectTypes";
import { wireLayerFetchStreams } from "./geoMapFetchWire";

export type GeoMapDataSyncDependencies = {
  subscriptions: Subscription;
  destroy$: Subject<void>;
  heatmapManualRefresh$: Subject<void>;
  canRenderHeatmap(): boolean;
  renderActiveLayers(forceRegions?: boolean): void;
  performInitialAutoFitOnce(): void;
  hideEventsHeatmap(): void;
  applyHeatmapData(data: HeatmapFetchData): void;
};

/** Подключает store/effect потоки после готовности источников MapLibre. */
export function wireGeoMapDataSync({
  subscriptions,
  destroy$,
  heatmapManualRefresh$,
  canRenderHeatmap,
  renderActiveLayers,
  performInitialAutoFitOnce,
  hideEventsHeatmap,
  applyHeatmapData,
}: GeoMapDataSyncDependencies): void {
  const effectSignals: GeoMapEffectSignals = { heatmapManualRefresh$ };
  const fetchStreams = createGeoMapFetchStreams(effectSignals);

  wireLayerFetchStreams({
    sub: subscriptions,
    destroy$,
    layerId: "regions",
    streams: fetchStreams.regions,
    fallbackError: "Ошибка загрузки геометрии",
  });

  wireLayerFetchStreams({
    sub: subscriptions,
    destroy$,
    layerId: "districts",
    streams: fetchStreams.districts,
    fallbackError: "Ошибка загрузки районов",
  });

  wireLayerFetchStreams({
    sub: subscriptions,
    destroy$,
    layerId: "heatmap",
    streams: fetchStreams.heatmap,
    fallbackError: "Ошибка загрузки теплокарты",
    onData: (data) => {
      if (!canRenderHeatmap()) return;
      applyHeatmapData(data);
    },
  });

  subscriptions.add(
    geoRenderTick$().pipe(takeUntil(destroy$)).subscribe(() => {
      renderActiveLayers();
      performInitialAutoFitOnce();
    }),
  );

  subscriptions.add(
    heatmapEventTypesFilter$.pipe(takeUntil(destroy$)).subscribe((filter) => {
      if (!canRenderHeatmap()) return;
      if (!hasActiveHeatmapEventTypesFilter(filter)) hideEventsHeatmap();
    }),
  );

  mapCanvasReady$.next(true);
  renderActiveLayers(true);
}
