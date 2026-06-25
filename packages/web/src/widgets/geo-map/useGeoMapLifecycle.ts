/**
 * useGeoMapLifecycle — MapLibre init, RxJS-подписки и side effects карты.
 * UI-оверлеи вынесены в AppShell (GeoMapOverlays); виджет — только canvas.
 */
import { useEffect, useRef, type RefObject } from "react";
import type {
  Map as MapLibreMap,
  MapLayerMouseEvent,
  MapLibreEvent,
  Popup,
} from "maplibre-gl";
import { Subject, Subscription, takeUntil } from "rxjs";
import {
  DISTRICT_MAP_MIN_ZOOM,
  DISTRICT_MAP_STROKE_WIDTH,
  EVENTS_HEATMAP_LAYER,
  EVENTS_HEATMAP_POINTS_LAYER,
  EVENTS_HEATMAP_SOURCE,
  eventsHeatmapPaint,
  eventsHeatmapPointsPaint,
  EVENTS_HEATMAP_ZOOM_HEAT_MAX,
  EVENTS_HEATMAP_ZOOM_POINTS_MIN,
  GEO_MAP_PLACE_FILL_OPACITY,
  GEO_MAP_PLACE_STROKE_OPACITY,
  GEO_MAP_REGION_FILL_OPACITY,
  GEO_MAP_REGION_STROKE_OPACITY,
  LEVEL_COLORS,
  MAP_INITIAL_VIEW,
  MAP_SYMBOL_FONT,
  placeCircleRadiusByZoom,
  REGION_MAP_SELECTED_FILL_OPACITY,
  REGION_MAP_SELECTED_STROKE_WIDTH,
  REGION_MAP_SELECTION_HALO,
  REGION_MAP_STROKE_WIDTH,
  regionStateLevelColorExpression,
  resolveMapBasemapFallbackForTheme,
  resolveMapBasemapStyleForTheme,
} from "../../shared/config/mapConfig.service";
import { placesById$, regionsByCode$, mapViewAnchor$, vicinityScopesById$, derivedRegionCodes$ } from "../../shared/state/mapStore";
import { geoMapLayers$, type GeoMapLayerId } from "../../shared/state/mapLayerStore";
import {
  hasActiveHeatmapEventTypesFilter,
  heatmapEventTypesFilter$,
  setHeatmapMeta,
} from "../../shared/state/heatmapStore";
import { buildDistrictsCollection, buildRegionsCollection } from "../../shared/state/geoGeometryStore";
import { visibleRegionCodes } from "../../shared/state/derivations";
import { resetAllGeoMapLayerFetchStatus } from "../../shared/state/geoMapLayerFetchStore";
import { resetGeoMapStats, setGeoMapStats } from "../../shared/state/geoMapStatsStore";
import { selectRegion, selectedRegion$ } from "../../shared/state/selectionStore";
import { theme$ } from "../../shared/state/themeStore";
import {
  DISTRICTS_FILL,
  DISTRICTS_OUTLINE,
  DISTRICTS_SOURCE,
  FEATURE_SELECTED,
  PLACES_LAYER,
  PLACES_SOURCE,
  REGIONS_THREAT_HALO,
  REGIONS_THREAT_LAYER,
  REGIONS_THREAT_SOURCE,
  REGION_GEOJSON_SOURCE,
  REGIONS_FILL,
  REGIONS_OUTLINE,
  REGIONS_OUTLINE_SOURCE,
  REGIONS_SELECTION,
  REGIONS_SOURCE,
  VICINITY_SCOPES_FILL,
  VICINITY_SCOPES_OUTLINE,
  VICINITY_SCOPES_SOURCE,
} from "./geoMapLayerIds";
import {
  paintActiveDistricts,
  paintRegionOutlines,
  placesCollection,
  placesToFeatures,
  regionThreatMarkersCollection,
  vicinityScopesCollection,
} from "./geoMapPaint";
import { createGeoMapRuntime, whenStyleReady, wireMapBootstrap } from "./geoMapRuntime";
import {
  createGeoMapFetchStreams,
  type GeoMapEffectSignals,
} from "./geoMapEffects";
import {
  districtsPaint$,
  mapCanvasReady$,
  placesPaint$,
  regionsPaint$,
  threatIconsPaint$,
} from "../../shared/state/mapGeoPipeline";
import { wireLayerFetchStreams } from "./geoMapFetchWire";
import {
  markGeoMapLayerPainted,
  resetGeoMapLayerPainted,
  wireInitialGeoMapFit,
} from "./geoMapInitialFit";
import {
  afterStyleChange,
  applyEventsHeatmapPaint,
  buildPlacePopupLines,
  buildRegionPopupHtml,
  enforceGeoEntityLayerOrder,
  fitMapView,
  fitOperationalOverview,
  flyToRegion,
  hasChildEntityAtPointer,
  preserveUserLayers,
  syncGeoOverlayLayers,
} from "./geoMapEngine";
import type { GeoJsonCollection } from "./geoMapTypes";

/** MapLibre lifecycle: init, fetch-потоки, store-подписки, cleanup. */
export function useGeoMapLifecycle(containerRef: RefObject<HTMLDivElement | null>): void {
  /** Однократный auto-fit уже выполнен. */
  const didFitRef = useRef(false);
  /** Число place-точек на прошлом кадре — сброс fingerprint при 0→N. */
  const lastPlaceFeaturesRef = useRef(0);
  useEffect(() => {
    // --- Локальное состояние эффекта (не React state — живёт только пока смонтирован виджет) ---
    let map: MapLibreMap | null = null;
    /** true после unmount — гасит async-callback и подписки. */
    let disposed = false;
    const destroy$ = new Subject<void>();
    const heatmapManualRefresh$ = new Subject<void>();
    /** Все store-подписки карты — один Subscription, отписка на unmount (как ngOnDestroy). */
    const storeSubscriptions = new Subscription();
    /**
     * Инициализируем null, чтобы первый emit BehaviorSubject всегда обрабатывался
     * (иначе code === prev → early return → flyToRegion не вызывается).
     */
    let highlightedCode: string | null = null;
    /** Сброс фильтра до загрузки контуров — догоняем fit после regions-geojson. */
    let requestOverviewFit = !selectedRegion$.value;
    let placePopup: Popup | null = null;
    let regionPopup: Popup | null = null;
    let activePlacePopupId: string | null = null;
    let activeRegionPopupKey: string | null = null;
    /** Пользователь сдвинул карту до прихода geojson — не делаем auto-fit/stop. */
    let userAdjustedViewBeforeGeo = false;
    /** Программный fitBounds/flyTo — не считаем ручным pan. */
    let fittingView = false;
    /** Отписка wireMapBootstrap при unmount. */
    let disposeMapBootstrap: (() => void) | null = null;
    /** ResizeObserver — flex-контейнер получает размер после mount. */
    let resizeObserver: ResizeObserver | null = null;
    /** Однократная инициализация слоёв и подписок (не привязана к успеху тайлов). */
    let mapBootstrapped = false;
    // Хранит ссылку на maplibre после динамического import — нужна для Popup в обработчиках
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let maplibreRef: any = null;

    /** Runtime карты: fingerprints, popup LRU, feature-state — один closure на виджет. */
    const runtime = createGeoMapRuntime({
      getMap: () => map,
      isDisposed: () => disposed,
    });

    /** Обзор всех активных регионов/мест — только по явному сбросу выбора региона. */
    const tryFitOverview = (duration: number): void => {
      const baseRegions = buildRegionsCollection();
      if (!map || baseRegions.features.length === 0 || highlightedCode) return;
      whenStyleReady(map, () => {
        if (!map || highlightedCode) return;
        const regions = buildRegionsCollection();
        if (regions.features.length === 0) return;
        fittingView = true;
        try {
          map.stop();
          fitOperationalOverview(map, regions, duration);
          requestOverviewFit = false;
        } finally {
          fittingView = false;
        }
      });
    };

    /** Единственный auto-fit при загрузке — после forkJoin всех включённых слоёв. */
    const performInitialAutoFitOnce = (): void => {
      if (!map || userAdjustedViewBeforeGeo || didFitRef.current) return;

      const now = mapViewAnchor$.value;
      const painted = paintRegionOutlines(
        buildRegionsCollection(),
        regionsByCode$.value,
        now,
      );
      const placeFeatures = placesToFeatures(
        placesById$.value,
        regionsByCode$.value,
        now,
      );
      if (painted.features.length === 0 && placeFeatures.length === 0) return;

      fittingView = true;
      try {
        fitMapView(map, painted.features, placeFeatures);
        didFitRef.current = true;
        requestOverviewFit = false;
      } finally {
        fittingView = false;
        requestAnimationFrame(() => {
          if (!map || disposed) return;
          runtime.sources.clearFingerprint(PLACES_SOURCE);
          runtime.sources.clearFingerprint(REGIONS_THREAT_SOURCE);
          syncLayerVisibility();
          map.resize();
          map.triggerRepaint();
        });
      }
    };

    /** Однократная подписка forkJoin — отписывается после первого fit. */
    const wireInitialFitOnce = (): void => {
      storeSubscriptions.add(
        wireInitialGeoMapFit({
          destroy$,
          shouldSkip: () => userAdjustedViewBeforeGeo || didFitRef.current,
          onAllLayersReady: () => performInitialAutoFitOnce(),
        }),
      );
    };

    const syncRegionsFromStores = (forceRegions = false): void => {
      if (disposed || !map) return;
      applyRegions(forceRegions);
    };

    const syncDistrictsFromStores = (): void => {
      if (disposed || !map) return;
      applyDistrictsLayer(buildDistrictsCollection());
    };

    const syncPlacesFromStores = (): void => {
      if (disposed || !map) return;
      applyPlacesCentroids();
      applyVicinityScopes();
    };

    const syncThreatIconsFromStores = (): void => {
      if (disposed || !map) return;
      applyThreatMarkers();
    };

    /** Синхронизирует visibility оверлеев с mapLayerStore после paint/recovery. */
    const syncLayerVisibility = (): void => {
      if (!map) return;
      whenStyleReady(map, () => {
        if (!map || disposed) return;
        syncGeoOverlayLayers(map, geoMapLayers$.value);
      });
    };

    /** Реакция на toggle слоя: мгновенная visibility; paint — через layer-specific tick$. */
    const handleGeoLayerToggle = (
      layers: Record<GeoMapLayerId, boolean>,
    ): void => {
      if (!map || disposed) return;
      whenStyleReady(map, () => {
        if (!map || disposed) return;
        syncGeoOverlayLayers(map, layers);
        if (!layers.heatmap) hideEventsHeatmap();
      });
    };

    /** После geo-fetch — только repaint, без fit. */
    const scheduleGeoLayerRecovery = (): void => {
      if (disposed || !map) return;
      syncLayerVisibility();
      map.resize();
      map.triggerRepaint();
    };

    /**
     * Перекрашивает контуры регионов из geoGeometryStore + regionsByCode$.
     * force=true — сбрасывает fingerprint (смена темы, fade-тик).
     */
    /** Регионы ждут lazy geo-fetch — не закрываем forkJoin пустым paint. */
    const regionsAwaitingGeoFetch = (now: number): boolean => {
      if (!geoMapLayers$.value.regions) return false;
      if (visibleRegionCodes(regionsByCode$.value, now).length === 0) return false;
      return buildRegionsCollection().features.length === 0;
    };

    const applyRegions = (force = false): void => {
      if (!map) return;
      if (!geoMapLayers$.value.regions && !force) return;
      whenStyleReady(map, () => {
        if (!map) return;
        const baseRegions = buildRegionsCollection();
        const now = mapViewAnchor$.value;
        const paintFingerprint = runtime.regions.buildPaintFingerprint(now);
        const painted = paintRegionOutlines(
          baseRegions,
          regionsByCode$.value,
          now,
        );
        if (painted.features.length === 0) {
          runtime.sources.pushRegions(
            { type: "FeatureCollection", features: [] },
            force,
            () => {},
          );
          syncLayerVisibility();
          if (!regionsAwaitingGeoFetch(now)) {
            markGeoMapLayerPainted("regions");
          }
          return;
        }
        if (runtime.regions.shouldSkipPaint(paintFingerprint, force)) {
          if (!regionsAwaitingGeoFetch(now)) {
            markGeoMapLayerPainted("regions");
          }
          return;
        }
        runtime.regions.markPainted(paintFingerprint);
        if (force) {
          runtime.sources.invalidateRegions();
        }
        setGeoMapStats({ regionOutlines: painted.features.length });
        runtime.sources.pushRegions(painted, force, () => {
          if (highlightedCode && map) {
            runtime.selection.setRegionSelected(highlightedCode, true);
          }
          markGeoMapLayerPainted("regions");
        });
        syncLayerVisibility();
      });
    };

    /**
     * Рендерит слой районов из кеша geoGeometryStore (lazy per geoFeatureId).
     * HTTP — через geoMapEffects на place-state / places-state.
     */
    const applyDistrictsLayer = (layer: GeoJsonCollection): void => {
      if (!map) return;
      if (!geoMapLayers$.value.districts) return;
      whenStyleReady(map, () => {
        if (!map) return;
        const painted = paintActiveDistricts(
          layer,
          placesById$.value,
          regionsByCode$.value,
          mapViewAnchor$.value,
        );
        runtime.sources.apply(DISTRICTS_SOURCE, painted);
        syncLayerVisibility();
      });
    };

    /** Centroids places: только fold-state (lat/lon), без geo HTTP. */
    const applyPlacesCentroids = (): void => {
      if (!map) return;
      if (!geoMapLayers$.value.places) {
        markGeoMapLayerPainted("places");
        return;
      }
      whenStyleReady(map, () => {
        if (!map) return;
        const now = mapViewAnchor$.value;
        const collection = placesCollection(
          placesById$.value,
          regionsByCode$.value,
          now,
        );
        const featureCount = collection.features.length;
        if (featureCount !== lastPlaceFeaturesRef.current) {
          runtime.sources.clearFingerprint(PLACES_SOURCE);
        }
        setGeoMapStats({ placeCount: featureCount });
        lastPlaceFeaturesRef.current = featureCount;
        runtime.sources.apply(PLACES_SOURCE, collection);
        syncLayerVisibility();
        markGeoMapLayerPainted("places");
      });
    };

    /** Vicinity scope кольца из fold snapshot. */
    const applyVicinityScopes = (): void => {
      if (!map) return;
      whenStyleReady(map, () => {
        if (!map) return;
        const collection = vicinityScopesCollection(
          vicinityScopesById$.value,
          regionsByCode$.value,
          mapViewAnchor$.value,
        );
        runtime.sources.apply(VICINITY_SCOPES_SOURCE, collection);
        syncLayerVisibility();
      });
    };

    /** Symbol layer: иконки типа угрозы в centroid региона. */
    const applyThreatMarkers = (): void => {
      if (!map) return;
      if (!geoMapLayers$.value.threatIcons) {
        markGeoMapLayerPainted("threatIcons");
        return;
      }
      whenStyleReady(map, () => {
        if (!map) return;
        const now = mapViewAnchor$.value;
        const collection = regionThreatMarkersCollection(
          regionsByCode$.value,
          derivedRegionCodes$.value,
          now,
        );
        runtime.sources.apply(REGIONS_THREAT_SOURCE, collection);
        syncLayerVisibility();
        markGeoMapLayerPainted("threatIcons");
      });
    };

    /** Скрывает слои теплокарты и сбрасывает meta при выключении в mapLayerStore. */
    const hideEventsHeatmap = (): void => {
      for (const layerId of [EVENTS_HEATMAP_LAYER, EVENTS_HEATMAP_POINTS_LAYER]) {
        if (map?.getLayer(layerId)) {
          map.setLayoutProperty(layerId, "visibility", "none");
        }
      }
      setHeatmapMeta(null);
    };

    /**
     * Добавляет источники, слои и обработчики событий на карту.
     * Вызывается при начальной загрузке и при каждой смене стиля (map.setStyle).
     * После setStyle все источники и слои удаляются — их нужно переинициализировать.
     */
    const setupLayersAndHandlers = (): void => {
      if (!map || !maplibreRef) return;
      const ml = maplibreRef;

      // --- Регионы ---
      if (!map.getSource(REGIONS_SOURCE)) {
        map.addSource(REGIONS_SOURCE, {
          ...REGION_GEOJSON_SOURCE,
          data: { type: "FeatureCollection", features: [] },
        });
      }
      if (!map.getSource(REGIONS_OUTLINE_SOURCE)) {
        map.addSource(REGIONS_OUTLINE_SOURCE, {
          ...REGION_GEOJSON_SOURCE,
          data: { type: "FeatureCollection", features: [] },
        });
      }
      if (!map.getLayer(REGIONS_FILL)) {
        map.addLayer({
          id: REGIONS_FILL,
          type: "fill",
          source: REGIONS_SOURCE,
          filter: ["==", ["get", "kind"], "region"],
          paint: {
            "fill-color": regionStateLevelColorExpression() as never,
            "fill-opacity": [
              "case",
              FEATURE_SELECTED,
              REGION_MAP_SELECTED_FILL_OPACITY,
              ["coalesce", ["get", "fillOpacity"], GEO_MAP_REGION_FILL_OPACITY],
            ],
          },
        });
      }
      if (!map.getLayer(REGIONS_OUTLINE)) {
        map.addLayer({
          id: REGIONS_OUTLINE,
          type: "line",
          source: REGIONS_OUTLINE_SOURCE,
          filter: ["==", ["get", "kind"], "region"],
          paint: {
            "line-color": regionStateLevelColorExpression() as never,
            "line-width": REGION_MAP_STROKE_WIDTH,
            "line-opacity": ["coalesce", ["get", "lineOpacity"], GEO_MAP_REGION_STROKE_OPACITY],
          },
        });
      }
      if (!map.getLayer(REGIONS_SELECTION)) {
        map.addLayer({
          id: REGIONS_SELECTION,
          type: "line",
          source: REGIONS_OUTLINE_SOURCE,
          filter: ["==", ["get", "kind"], "region"],
          paint: {
            "line-color": REGION_MAP_SELECTION_HALO,
            "line-width": REGION_MAP_SELECTED_STROKE_WIDTH + 1.5,
            "line-opacity": ["case", FEATURE_SELECTED, 0.9, 0],
          },
        });
      }

      // --- Районы ---
      if (!map.getSource(DISTRICTS_SOURCE)) {
        map.addSource(DISTRICTS_SOURCE, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
      if (!map.getLayer(DISTRICTS_FILL)) {
        map.addLayer({
          id: DISTRICTS_FILL,
          type: "fill",
          source: DISTRICTS_SOURCE,
          minzoom: DISTRICT_MAP_MIN_ZOOM,
          paint: {
            "fill-color": ["coalesce", ["get", "color"], LEVEL_COLORS.yellow],
            "fill-opacity": ["coalesce", ["get", "fillOpacity"], GEO_MAP_PLACE_FILL_OPACITY],
          },
        });
      }
      if (!map.getLayer(DISTRICTS_OUTLINE)) {
        map.addLayer({
          id: DISTRICTS_OUTLINE,
          type: "line",
          source: DISTRICTS_SOURCE,
          minzoom: DISTRICT_MAP_MIN_ZOOM - 1,
          paint: {
            "line-color": ["coalesce", ["get", "color"], LEVEL_COLORS.yellow],
            "line-width": DISTRICT_MAP_STROKE_WIDTH,
            "line-opacity": ["coalesce", ["get", "lineOpacity"], GEO_MAP_PLACE_STROKE_OPACITY],
          },
        });
      }

      // --- Теплокарта (над region/district, под places) ---
      if (!map.getSource(EVENTS_HEATMAP_SOURCE)) {
        map.addSource(EVENTS_HEATMAP_SOURCE, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
      if (!map.getLayer(EVENTS_HEATMAP_LAYER)) {
        map.addLayer({
          id: EVENTS_HEATMAP_LAYER,
          type: "heatmap",
          source: EVENTS_HEATMAP_SOURCE,
          maxzoom: EVENTS_HEATMAP_ZOOM_HEAT_MAX,
          layout: { visibility: "none" },
          paint: eventsHeatmapPaint(theme$.value) as never,
        });
      } else {
        applyEventsHeatmapPaint(map, theme$.value);
      }
      if (!map.getLayer(EVENTS_HEATMAP_POINTS_LAYER)) {
        map.addLayer({
          id: EVENTS_HEATMAP_POINTS_LAYER,
          type: "circle",
          source: EVENTS_HEATMAP_SOURCE,
          minzoom: EVENTS_HEATMAP_ZOOM_POINTS_MIN,
          layout: { visibility: "none" },
          paint: eventsHeatmapPointsPaint(theme$.value) as never,
        });
      }

      // --- Vicinity scopes (между heatmap и places) ---
      if (!map.getSource(VICINITY_SCOPES_SOURCE)) {
        map.addSource(VICINITY_SCOPES_SOURCE, {
          type: "geojson",
          data: vicinityScopesCollection(new Map(), new Map()),
        });
      }
      if (!map.getLayer(VICINITY_SCOPES_FILL)) {
        map.addLayer({
          id: VICINITY_SCOPES_FILL,
          type: "fill",
          source: VICINITY_SCOPES_SOURCE,
          filter: ["==", ["get", "kind"], "vicinity-scope"],
          paint: {
            "fill-color": ["coalesce", ["get", "color"], "#FFD54F"],
            "fill-opacity": ["coalesce", ["get", "fillOpacity"], 0.08],
          },
        });
      }
      if (!map.getLayer(VICINITY_SCOPES_OUTLINE)) {
        map.addLayer({
          id: VICINITY_SCOPES_OUTLINE,
          type: "line",
          source: VICINITY_SCOPES_SOURCE,
          filter: ["==", ["get", "kind"], "vicinity-scope"],
          paint: {
            "line-color": ["coalesce", ["get", "color"], "#FFD54F"],
            "line-width": 2,
            "line-opacity": ["coalesce", ["get", "lineOpacity"], 0.6],
          },
        });
      }

      // --- Threat icons (centroid) ---
      if (!map.getSource(REGIONS_THREAT_SOURCE)) {
        map.addSource(REGIONS_THREAT_SOURCE, {
          type: "geojson",
          data: regionThreatMarkersCollection(new Map(), new Set()) as never,
        });
      }
      if (!map.getLayer(REGIONS_THREAT_HALO)) {
        map.addLayer({
          id: REGIONS_THREAT_HALO,
          type: "circle",
          source: REGIONS_THREAT_SOURCE,
          layout: { visibility: "none" },
          paint: {
            "circle-radius": ["coalesce", ["get", "haloRadius"], 10],
            "circle-color": ["coalesce", ["get", "threatColor"], "#d93535"],
            "circle-opacity": ["*", ["coalesce", ["get", "textOpacity"], 1], 0.35],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
            "circle-stroke-opacity": ["coalesce", ["get", "textOpacity"], 1],
          },
        });
      }
      if (!map.getLayer(REGIONS_THREAT_LAYER)) {
        map.addLayer({
          id: REGIONS_THREAT_LAYER,
          type: "symbol",
          source: REGIONS_THREAT_SOURCE,
          layout: {
            visibility: "none",
            "text-field": ["get", "threatGlyph"],
            "text-font": [...MAP_SYMBOL_FONT],
            "text-size": [
              "match",
              ["get", "threatKey"],
              "rocket",
              22,
              "uav_mass",
              18,
              16,
            ],
            "text-allow-overlap": true,
            "text-ignore-placement": true,
            "text-anchor": "center",
          },
          paint: {
            "text-color": ["coalesce", ["get", "threatColor"], "#d93535"],
            "text-opacity": ["coalesce", ["get", "textOpacity"], 1],
            "text-halo-color": "#0d0f14",
            "text-halo-width": 2,
          },
        });
      }

      // --- Places ---
      if (!map.getSource(PLACES_SOURCE)) {
        map.addSource(PLACES_SOURCE, {
          type: "geojson",
          data: placesCollection(new Map(), new Map()),
        });
      }
      if (!map.getLayer(PLACES_LAYER)) {
        map.addLayer({
          id: PLACES_LAYER,
          type: "circle",
          source: PLACES_SOURCE,
          filter: ["==", ["get", "kind"], "place"],
          paint: {
            "circle-color": ["coalesce", ["get", "color"], LEVEL_COLORS.yellow],
            "circle-radius": placeCircleRadiusByZoom() as never,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
            "circle-opacity": ["coalesce", ["get", "circleOpacity"], GEO_MAP_PLACE_FILL_OPACITY],
            "circle-stroke-opacity": [
              "coalesce",
              ["get", "circleStrokeOpacity"],
              GEO_MAP_PLACE_STROKE_OPACITY,
            ],
          },
        });
      }

      enforceGeoEntityLayerOrder(map);
      syncGeoOverlayLayers(map, geoMapLayers$.value);

      // --- Обработчики событий (переустанавливаем после смены стиля) ---
      /** Клик по региону или place — toggle выбора в selectionStore. */
      const onPick = (event: MapLayerMouseEvent): void => {
        const props = event.features?.[0]?.properties;
        const code = props?.regionCode;
        if (typeof code === "string") {
          selectRegion(code === highlightedCode ? null : code);
        }
      };

      /** Popup place/района: сначала локальные строки, затем обогащение rawText с API. */
      const showPlacePopup = (lngLat: MapLayerMouseEvent["lngLat"], placeId: string): void => {
        if (!map) return;
        activePlacePopupId = placeId;
        activeRegionPopupKey = null;
        regionPopup?.remove();
        regionPopup = null;
        map.getCanvas().style.cursor = "pointer";

        const lines = buildPlacePopupLines(placeId);
        if (lines.length === 0) return;

        placePopup?.remove();
        placePopup = new ml.Popup({
          closeButton: false,
          closeOnClick: false,
          className: "geo-map-place-popup",
          offset: 12,
        })
          .setLngLat(lngLat)
          .setText(lines.join("\n"))
          .addTo(map);

        void runtime.popups.resolvePlaceSource(placeId).then((sourceMessage) => {
          if (!map || !placePopup || activePlacePopupId !== placeId) return;
          const enriched = buildPlacePopupLines(placeId, sourceMessage);
          if (enriched.length === 0) return;
          placePopup.setText(enriched.join("\n"));
        });
      };

      /** Hover по кружку place — показываем popup. */
      const onPlaceHover = (event: MapLayerMouseEvent): void => {
        const placeId = event.features?.[0]?.properties?.placeId;
        if (typeof placeId !== "string" || !placeId) return;
        showPlacePopup(event.lngLat, placeId);
      };

      /** Hover по полигону района — тот же popup, что у place (общий placeId в properties). */
      const onDistrictHover = (event: MapLayerMouseEvent): void => {
        const placeId = event.features?.[0]?.properties?.placeId;
        if (typeof placeId !== "string" || !placeId) return;
        showPlacePopup(event.lngLat, placeId);
      };

      /** Уход курсора с place/района — скрываем popup и сбрасываем cursor. */
      const onPlaceHoverEnd = (): void => {
        if (!map) return;
        map.getCanvas().style.cursor = "";
        activePlacePopupId = null;
        placePopup?.remove();
        placePopup = null;
      };

      /**
       * Hover по региону: tooltip с уровнем и winner-сообщением (API + лента).
       * Под place/районом — не показываем (дочерняя сущность перекрывает регион).
       */
      const showRegionPopup = (lngLat: MapLayerMouseEvent["lngLat"], code: string): void => {
        if (!map) return;
        const region = regionsByCode$.value.get(code);
        const popupKey = `${code}:${region?.statusEventAt ?? ""}`;
        activeRegionPopupKey = popupKey;
        placePopup?.remove();
        placePopup = null;
        activePlacePopupId = null;
        map.getCanvas().style.cursor = "pointer";

        regionPopup?.remove();
        regionPopup = new ml.Popup({
          closeButton: false,
          closeOnClick: false,
          className: "geo-map-region-popup",
          offset: 12,
        })
          .setLngLat(lngLat)
          .setHTML(buildRegionPopupHtml(code))
          .addTo(map);

        void runtime.popups.resolveRegionSource(code, region?.statusEventAt).then((sourceMessage) => {
          if (!map || !regionPopup || activeRegionPopupKey !== popupKey) return;
          regionPopup.setHTML(buildRegionPopupHtml(code, sourceMessage));
        });
      };

      const onRegionHover = (event: MapLayerMouseEvent): void => {
        if (!map) return;
        if (hasChildEntityAtPointer(map, event.point)) {
          regionPopup?.remove();
          regionPopup = null;
          activeRegionPopupKey = null;
          return;
        }
        const code = event.features?.[0]?.properties?.regionCode;
        if (typeof code !== "string" || !code) return;
        showRegionPopup(event.lngLat, code);
      };

      /** Уход курсора с региона — скрываем region popup. */
      const onRegionHoverEnd = (): void => {
        if (!map) return;
        map.getCanvas().style.cursor = "";
        activeRegionPopupKey = null;
        regionPopup?.remove();
        regionPopup = null;
      };

      // Привязка pointer-событий к слоям (пересоздаётся в setupLayersAndHandlers после setStyle).
      map.on("click", REGIONS_FILL, onPick);
      map.on("click", REGIONS_OUTLINE, onPick);
      map.on("click", PLACES_LAYER, onPick);
      map.on("mouseenter", PLACES_LAYER, onPlaceHover);
      map.on("mousemove", PLACES_LAYER, onPlaceHover);
      map.on("mouseleave", PLACES_LAYER, onPlaceHoverEnd);
      map.on("mouseenter", DISTRICTS_FILL, onDistrictHover);
      map.on("mousemove", DISTRICTS_FILL, onDistrictHover);
      map.on("mouseleave", DISTRICTS_FILL, onPlaceHoverEnd);
      map.on("mouseenter", DISTRICTS_OUTLINE, onDistrictHover);
      map.on("mousemove", DISTRICTS_OUTLINE, onDistrictHover);
      map.on("mouseleave", DISTRICTS_OUTLINE, onPlaceHoverEnd);
      map.on("mousemove", REGIONS_FILL, onRegionHover);
      map.on("mouseleave", REGIONS_FILL, onRegionHoverEnd);

      // Только пользовательский pan/zoom — программный fitBounds не блокирует auto-fit.
      map.on("movestart", (event: MapLibreEvent) => {
        if (fittingView || didFitRef.current) return;
        if (!event.originalEvent) return;
        userAdjustedViewBeforeGeo = true;
      });
    };

    // --- Инициализация MapLibre (dynamic import — code-splitting) ---
    void (async () => {
      const maplibre = (await import("maplibre-gl")).default;
      await import("maplibre-gl/dist/maplibre-gl.css");
      if (disposed || !containerRef.current) return;
      maplibreRef = maplibre;

      map = new maplibre.Map({
        container: containerRef.current,
        style: resolveMapBasemapStyleForTheme(theme$.value) as never,
        center: MAP_INITIAL_VIEW.center,
        zoom: MAP_INITIAL_VIEW.zoom,
        attributionControl: { compact: true },
      });

      const container = containerRef.current;
      if (container && typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => {
          if (disposed || !map) return;
          map.resize();
          map.triggerRepaint();
        });
        resizeObserver.observe(container);
      }

      // Подписка сразу после создания map — не ждём load, иначе toggle до load теряется.
      storeSubscriptions.add(
        geoMapLayers$.pipe(takeUntil(destroy$)).subscribe((layers) => {
          handleGeoLayerToggle(layers);
        }),
      );

      // Карта и стиль готовы — слои, первая загрузка данных, RxJS-подписки.
      // Не ждём map.load с успешными тайлами: wireMapBootstrap + fallback minimal style.
      const bootstrapMap = (): void => {
        if (!map || mapBootstrapped) return;
        mapBootstrapped = true;

        setupLayersAndHandlers();
        map.resize();

        const effectSignals: GeoMapEffectSignals = { heatmapManualRefresh$ };
        const fetchStreams = createGeoMapFetchStreams(effectSignals);

        wireLayerFetchStreams({
          sub: storeSubscriptions,
          destroy$,
          layerId: "regions",
          streams: fetchStreams.regions,
          fallbackError: "Ошибка загрузки геометрии",
          onData: () => {
            if (disposed || !map) return;
            applyRegions(true);
            scheduleGeoLayerRecovery();
          },
          onFetchError: () => markGeoMapLayerPainted("regions"),
        });

        wireLayerFetchStreams({
          sub: storeSubscriptions,
          destroy$,
          layerId: "districts",
          streams: fetchStreams.districts,
          fallbackError: "Ошибка загрузки районов",
          onData: (layer) => {
            if (disposed || !map) return;
            applyDistrictsLayer(layer);
            markGeoMapLayerPainted("districts");
          },
          onFetchError: () => markGeoMapLayerPainted("districts"),
        });

        wireLayerFetchStreams({
          sub: storeSubscriptions,
          destroy$,
          layerId: "heatmap",
          streams: fetchStreams.heatmap,
          fallbackError: "Ошибка загрузки теплокарты",
          onData: (data) => {
            if (disposed || !map || !geoMapLayers$.value.heatmap) return;
            setHeatmapMeta(data.meta);
            runtime.sources.apply(EVENTS_HEATMAP_SOURCE, {
              type: "FeatureCollection",
              features: data.features,
            });
            syncGeoOverlayLayers(map, geoMapLayers$.value);
            markGeoMapLayerPainted("heatmap");
          },
          onFetchError: () => markGeoMapLayerPainted("heatmap"),
        });

        // Развязанные подписки: каждый слой реагирует только на свой slice store/geo.
        storeSubscriptions.add(
          placesPaint$().pipe(takeUntil(destroy$)).subscribe(() => {
            syncPlacesFromStores();
          }),
        );
        storeSubscriptions.add(
          regionsPaint$().pipe(takeUntil(destroy$)).subscribe(() => {
            syncRegionsFromStores();
          }),
        );
        storeSubscriptions.add(
          districtsPaint$().pipe(takeUntil(destroy$)).subscribe(() => {
            syncDistrictsFromStores();
          }),
        );
        storeSubscriptions.add(
          threatIconsPaint$().pipe(takeUntil(destroy$)).subscribe(() => {
            syncThreatIconsFromStores();
          }),
        );

        storeSubscriptions.add(
          heatmapEventTypesFilter$.pipe(takeUntil(destroy$)).subscribe((filter) => {
            if (!map || disposed || !geoMapLayers$.value.heatmap) return;
            if (!hasActiveHeatmapEventTypesFilter(filter)) hideEventsHeatmap();
          }),
        );

        mapCanvasReady$.next(true);
        wireInitialFitOnce();

        if (
          geoMapLayers$.value.heatmap
          && !hasActiveHeatmapEventTypesFilter(heatmapEventTypesFilter$.value)
        ) {
          markGeoMapLayerPainted("heatmap");
        }

        // Догоняем paint, если fold/geo уже в store; resize после layout-pass.
        syncRegionsFromStores(true);
        syncPlacesFromStores();
        syncThreatIconsFromStores();
        requestAnimationFrame(() => {
          if (!map || disposed) return;
          map.resize();
          map.triggerRepaint();
        });

        let appliedTheme = theme$.value;
        storeSubscriptions.add(
          theme$.pipe(takeUntil(destroy$)).subscribe((theme) => {
          if (!map || disposed || theme === appliedTheme) return;
          appliedTheme = theme;
          placePopup?.remove();
          regionPopup?.remove();
          // transformStyle сохраняет наши GeoJSON-источники и слои в новом стиле —
          // данные регионов и мест остаются, меняются только тайлы подложки.
          map.setStyle(resolveMapBasemapStyleForTheme(theme) as never, {
            transformStyle: preserveUserLayers,
          } as never);
          // После загрузки нового стиля восстанавливаем выделение региона.
          afterStyleChange(map, () => {
            if (disposed || !map) return;
            if (highlightedCode) {
              runtime.selection.setRegionSelected(highlightedCode, true);
            }
            applyRegions();
            applyDistrictsLayer(buildDistrictsCollection());
            applyPlacesCentroids();
            applyEventsHeatmapPaint(map, theme);
            syncGeoOverlayLayers(map, geoMapLayers$.value);
            if (geoMapLayers$.value.heatmap) heatmapManualRefresh$.next();
          }, {
            fallbackStyle: resolveMapBasemapFallbackForTheme(theme),
          });
          }),
        );

        // Выбор региона: feature-state + flyTo / overview fit.
        storeSubscriptions.add(
          selectedRegion$.pipe(takeUntil(destroy$)).subscribe((code) => {
          const prev = highlightedCode;
          runtime.selection.apply(prev, code);
          highlightedCode = code;

          if (!code) {
            requestOverviewFit = true;
            tryFitOverview(350);
            return;
          }
          requestOverviewFit = false;
          if (!map) return;
          if (code === prev) return;

          whenStyleReady(map, () => {
            if (!map) return;
            const regions = buildRegionsCollection();
            if (regions.features.length === 0) return;
            map.stop();
            const animate = prev === null;
            flyToRegion(map, code, regions, animate ? 320 : 0);
          });
          }),
        );
      };

      disposeMapBootstrap = wireMapBootstrap({
        map,
        theme: theme$.value,
        isDisposed: () => disposed,
        onReady: bootstrapMap,
      });
    })();

    // --- Cleanup: таймеры, подписки, popup, кэши, destroy map ---
    return () => {
      disposed = true;
      mapCanvasReady$.next(false);
      destroy$.next();
      destroy$.complete();
      storeSubscriptions.unsubscribe();
      resetAllGeoMapLayerFetchStatus();
      resetGeoMapStats();
      resetGeoMapLayerPainted();
      runtime.dispose();
      placePopup?.remove();
      placePopup = null;
      regionPopup?.remove();
      regionPopup = null;
      disposeMapBootstrap?.();
      resizeObserver?.disconnect();
      resizeObserver = null;
      map?.remove();
    };
  }, [containerRef]);
}
