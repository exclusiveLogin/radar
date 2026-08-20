/**
 * MapLibre runtime и рендер слоёв.
 *
 * Синхронизация данных находится в geoMapDataSync, переход live/replay —
 * в mapLiveReplayEffects. UI-оверлеи вынесены в GeoMapOverlays.
 */
import { useEffect, useRef, type RefObject } from "react";
import type {
  Map as MapLibreMap,
  MapLibreEvent,
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
  setHeatmapMeta,
} from "../../shared/state/heatmapStore";
import { buildDistrictsCollection, buildRegionsCollection } from "../../shared/state/geoGeometryStore";
import { resetAllGeoMapLayerFetchStatus } from "../../shared/state/geoMapLayerFetchStore";
import { resetGeoMapStats, setGeoMapStats } from "../../shared/state/geoMapStatsStore";
import {
  setLocusDebugFocus,
  tracksFlow$,
  tracksGravity$,
  tracksList$,
  tracksLoading$,
} from "../../shared/state/trackStore";
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
  TRACKS_FLOW_LAYER,
  TRACKS_FLOW_SOURCE,
  TRACKS_GRAVITY_LAYER,
  TRACKS_GRAVITY_SOURCE,
  TRACKS_LINES_DASHED_HIT_LAYER,
  TRACKS_LINES_LAYER,
  TRACKS_LINES_HIT_LAYER,
  TRACKS_LINES_DASHED_LAYER,
  TRACKS_LOCUS_LAYER,
  TRACKS_LOCUS_OUTLINE_LAYER,
  TRACKS_LOCUS_SOURCE,
  TRACKS_ORIGIN_LAYER,
  TRACKS_SOURCE,
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
  mapCanvasReady$,
} from "../../shared/state/mapGeoPipeline";
import { wireGeoMapDataSync } from "./geoMapDataSync";
import { wireGeoMapLiveReplayCoordination } from "./geoMapLiveReplayCoordination";
import {
  afterStyleChange,
  applyEventsHeatmapPaint,
  enforceGeoEntityLayerOrder,
  fitMapView,
  fitOperationalOverview,
  flyToRegion,
  preserveUserLayers,
  syncGeoOverlayLayers,
} from "./geoMapEngine";
import { createGeoMapInteractionController } from "./geoMapInteractions";
import {
  emptyTracksFeatureCollection,
  tracksFlowToGeoJson,
  tracksListToGeoJson,
} from "./tracksGeoJson";
import {
  tracksFlowLinesPaint,
  tracksHitLinesPaint,
  tracksLinesPaint,
  tracksOriginPaint,
} from "./tracksMapPaint";
import { createTracksDeckOverlay, type TracksDeckOverlay } from "./tracksDeckOverlay";
import { tracksListToTripsData } from "./tracksTripsData";
import { tracksLocusDebugToGeoJson } from "./tracksLocusDebugGeoJson";
import { tracksGravityHeatmapPaint, tracksGravityToGeoJson } from "./tracksGravityGeoJson";
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
    /** Deck.gl overlay для анимации направления L1-треков. */
    let tracksDeckOverlay: TracksDeckOverlay | null = null;

    /** Runtime карты: fingerprints, popup LRU, feature-state — один closure на виджет. */
    const runtime = createGeoMapRuntime({
      getMap: () => map,
      isDisposed: () => disposed,
    });
    let interactions: ReturnType<typeof createGeoMapInteractionController> | null = null;

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
        } finally {
          fittingView = false;
        }
      });
    };

    /**
     * Единственный auto-fit при загрузке — по ПЕРВОМУ осмысленному bbox.
     * Дёргается из единого geoRenderTick$ после каждого рендера и сам гейтится:
     * пока нет ни регионов, ни мест — выходит; как только появился bbox — фитит
     * ровно один раз. Не зависит от порядка готовности слоёв и ничего не красит
     * поштучно (покраска идёт только через тик).
     */
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
      } finally {
        fittingView = false;
      }
    };

    /**
     * Единый проход рендера: применяет ВСЕ активные слои за один тик в z-порядке.
     * Каждый apply гейтится своим тоглом и fingerprint-skip'ается → дёшево и идемпотентно.
     * Все setData ложатся в один JS-тик → MapLibre сводит их в ОДИН кадр (без рейсов).
     */
    /**
     * Единый проход рендера: применяет ВСЕ активные слои за один тик в z-порядке.
     * Каждый apply гейтится своим тоглом и fingerprint-skip'ается → дёшево и идемпотентно.
     * Все setData ложатся в один JS-тик → MapLibre сводит их в ОДИН кадр (без рейсов).
     * syncLayerVisibility вызывается ОДИН раз в конце, а не из каждого apply — иначе
     * setLayoutProperty(symbol-layer, "visible") запускает загрузку глифов, из-за чего
     * isStyleLoaded() возвращает false для последующих apply и их whenStyleReady-callback
     * никогда не выполняется (места, районы).
     */
    const renderActiveLayers = (forceRegions = false): void => {
      if (disposed || !map) return;
      applyRegions(forceRegions);
      applyDistrictsLayer(buildDistrictsCollection());
      applyThreatMarkers();
      applyVicinityScopes();
      applyPlacesCentroids();
      applyTracksLayers();
      syncLayerVisibility();
    };

    /** Синхронизирует visibility оверлеев с mapLayerStore после paint/recovery. */
    const syncLayerVisibility = (): void => {
      if (!map) return;
      whenStyleReady(map, () => {
        if (!map || disposed) return;
        syncGeoOverlayLayers(map, geoMapLayers$.value);
      });
    };

    /** Реакция на toggle слоя: мгновенная visibility; данные дотянет единый geoRenderTick$. */
    const handleGeoLayerToggle = (
      layers: Record<GeoMapLayerId, boolean>,
    ): void => {
      if (!map || disposed) return;
      whenStyleReady(map, () => {
        if (!map || disposed) return;
        syncGeoOverlayLayers(map, layers);
        tracksDeckOverlay?.setVisible(layers.tracksMotion);
        if (!layers.heatmap) hideEventsHeatmap();
      });
    };

    /**
     * Перекрашивает контуры регионов из geoGeometryStore + regionsByCode$.
     * force=true — сбрасывает fingerprint (смена темы, fade-тик).
     */
    const applyRegions = (force = false): void => {
      if (!map) return;
      if (!geoMapLayers$.value.regions && !force) return;
      whenStyleReady(map, () => {
        if (!map) return;
        const now = mapViewAnchor$.value;
        const painted = paintRegionOutlines(
          buildRegionsCollection(),
          regionsByCode$.value,
          now,
        );
        // Skip решает geoJsonFingerprint в pushRegions (видит и fold, и геометрию, и fade) —
        // отдельный fold-кэш убран, он не замечал приход lazy-геометрии.
        if (force) runtime.sources.invalidateRegions();
        setGeoMapStats({ regionOutlines: painted.features.length });
        runtime.sources.pushRegions(painted, force, () => {
          if (highlightedCode && map) {
            runtime.selection.setRegionSelected(highlightedCode, true);
          }
        });
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
      });
    };

    /** Centroids places: только fold-state (lat/lon), без geo HTTP. */
    const applyPlacesCentroids = (): void => {
      if (!map) return;
      if (!geoMapLayers$.value.places) return;
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
      });
    };

    /** Vicinity scope кольца из fold snapshot. */
    const applyVicinityScopes = (): void => {
      if (!map) return;
      if (!geoMapLayers$.value.vicinity) return;
      whenStyleReady(map, () => {
        if (!map) return;
        const collection = vicinityScopesCollection(
          vicinityScopesById$.value,
          mapViewAnchor$.value,
        );
        runtime.sources.apply(VICINITY_SCOPES_SOURCE, collection);
      });
    };

    /** Symbol layer: иконки типа угрозы в centroid региона. */
    const applyThreatMarkers = (): void => {
      if (!map) return;
      if (!geoMapLayers$.value.threatIcons) return;
      whenStyleReady(map, () => {
        if (!map) return;
        const now = mapViewAnchor$.value;
        const collection = regionThreatMarkersCollection(
          regionsByCode$.value,
          derivedRegionCodes$.value,
          now,
        );
        runtime.sources.apply(REGIONS_THREAT_SOURCE, collection);
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

    /** Создаёт Deck overlay при первом обращении (lazy, code-split). */
    const ensureTracksDeckOverlay = async (): Promise<void> => {
      if (!map || disposed || tracksDeckOverlay) return;
      tracksDeckOverlay = await createTracksDeckOverlay(map);
      tracksDeckOverlay.setVisible(geoMapLayers$.value.tracksMotion);
    };

    /** Пересоздаёт Deck overlay после map.setStyle (control привязан к style). */
    const recreateTracksDeckOverlay = async (): Promise<void> => {
      tracksDeckOverlay?.dispose();
      tracksDeckOverlay = null;
      if (!map || disposed || !geoMapLayers$.value.tracksMotion) return;
      const overlay = await createTracksDeckOverlay(map);
      tracksDeckOverlay = overlay;
      overlay.setVisible(true);
      overlay.update(tracksListToTripsData(tracksList$.value));
    };

    /** L1/L2 треки: MapLibre линии + Deck.gl движение (отдельные тоглы). */
    const applyTracksLayers = (): void => {
      if (!map || disposed) return;
      const layers = geoMapLayers$.value;
      const needsTracksData = layers.tracks || layers.tracksMotion || layers.locusDebug;

      if (!needsTracksData && !layers.tracksFlow && !layers.tracksGravity) {
        tracksDeckOverlay?.setVisible(false);
        return;
      }

      // Первый fetch L1 ещё идёт — не затираем tracks source; flow/gravity не блокируем.
      const tracksFetchPending =
        needsTracksData && tracksLoading$.value && !tracksList$.value;

      const activeLocusTrackId = interactions?.getActiveLocusTrackId() ?? null;

      whenStyleReady(map, () => {
        if (!map || disposed) return;

        if (layers.tracks && !tracksFetchPending) {
          runtime.sources.apply(
            TRACKS_SOURCE,
            tracksListToGeoJson(tracksList$.value, { showSegmentOnlyDrafts: true }),
          );
        }

        if (layers.tracksMotion && !tracksFetchPending) {
          void ensureTracksDeckOverlay().then(() => {
            if (!tracksDeckOverlay || disposed) return;
            tracksDeckOverlay.update(tracksListToTripsData(tracksList$.value));
            tracksDeckOverlay.setVisible(true);
          });
        } else {
          tracksDeckOverlay?.setVisible(false);
        }

        if (layers.tracksFlow) {
          runtime.sources.apply(
            TRACKS_FLOW_SOURCE,
            tracksFlowToGeoJson(tracksFlow$.value),
          );
        }

        if (layers.tracksGravity) {
          runtime.sources.apply(
            TRACKS_GRAVITY_SOURCE,
            tracksGravityToGeoJson(tracksGravity$.value),
          );
        }

        if (layers.locusDebug && !tracksFetchPending) {
          runtime.sources.apply(
            TRACKS_LOCUS_SOURCE,
            tracksLocusDebugToGeoJson(tracksList$.value, {
              trackId: activeLocusTrackId,
            }) as GeoJsonCollection,
          );
        }
      });
    };

    /**
     * Добавляет источники и слои на карту.
     * Вызывается при начальной загрузке и при каждой смене стиля (map.setStyle).
     * После setStyle все источники и слои удаляются — их нужно переинициализировать.
     */
    const setupLayers = (): void => {
      if (!map) return;

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

      // --- Треки (debug MVP: линии + origin, flow-коридоры) ---
      if (!map.getSource(TRACKS_SOURCE)) {
        map.addSource(TRACKS_SOURCE, {
          type: "geojson",
          data: emptyTracksFeatureCollection(),
        });
      }
      if (!map.getLayer(TRACKS_LINES_LAYER)) {
        map.addLayer({
          id: TRACKS_LINES_LAYER,
          type: "line",
          source: TRACKS_SOURCE,
          filter: [
            "all",
            ["==", ["get", "kind"], "track-line"],
            ["!=", ["get", "mode"], "segment_only"],
          ],
          layout: { visibility: "none" },
          paint: tracksLinesPaint() as never,
        });
      }
      if (!map.getLayer(TRACKS_LINES_HIT_LAYER)) {
        map.addLayer({
          id: TRACKS_LINES_HIT_LAYER,
          type: "line",
          source: TRACKS_SOURCE,
          filter: [
            "all",
            ["==", ["get", "kind"], "track-line"],
            ["!=", ["get", "mode"], "segment_only"],
          ],
          layout: { visibility: "none" },
          paint: tracksHitLinesPaint() as never,
        });
      }
      if (!map.getLayer(TRACKS_LINES_DASHED_LAYER)) {
        map.addLayer({
          id: TRACKS_LINES_DASHED_LAYER,
          type: "line",
          source: TRACKS_SOURCE,
          filter: [
            "all",
            ["==", ["get", "kind"], "track-line"],
            ["==", ["get", "mode"], "segment_only"],
          ],
          layout: { visibility: "none" },
          paint: tracksLinesPaint(true) as never,
        });
      }
      if (!map.getLayer(TRACKS_LINES_DASHED_HIT_LAYER)) {
        map.addLayer({
          id: TRACKS_LINES_DASHED_HIT_LAYER,
          type: "line",
          source: TRACKS_SOURCE,
          filter: [
            "all",
            ["==", ["get", "kind"], "track-line"],
            ["==", ["get", "mode"], "segment_only"],
          ],
          layout: { visibility: "none" },
          paint: tracksHitLinesPaint() as never,
        });
      }
      if (!map.getLayer(TRACKS_ORIGIN_LAYER)) {
        map.addLayer({
          id: TRACKS_ORIGIN_LAYER,
          type: "circle",
          source: TRACKS_SOURCE,
          filter: ["==", ["get", "kind"], "track-origin"],
          layout: { visibility: "none" },
          paint: tracksOriginPaint() as never,
        });
      }
      if (!map.getSource(TRACKS_FLOW_SOURCE)) {
        map.addSource(TRACKS_FLOW_SOURCE, {
          type: "geojson",
          data: emptyTracksFeatureCollection(),
        });
      }
      if (!map.getLayer(TRACKS_FLOW_LAYER)) {
        map.addLayer({
          id: TRACKS_FLOW_LAYER,
          type: "line",
          source: TRACKS_FLOW_SOURCE,
          layout: { visibility: "none" },
          paint: tracksFlowLinesPaint() as never,
        });
      }
      if (!map.getSource(TRACKS_GRAVITY_SOURCE)) {
        map.addSource(TRACKS_GRAVITY_SOURCE, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
      if (!map.getLayer(TRACKS_GRAVITY_LAYER)) {
        map.addLayer({
          id: TRACKS_GRAVITY_LAYER,
          type: "heatmap",
          source: TRACKS_GRAVITY_SOURCE,
          layout: { visibility: "none" },
          paint: tracksGravityHeatmapPaint(theme$.value) as never,
        });
      }
      if (!map.getSource(TRACKS_LOCUS_SOURCE)) {
        map.addSource(TRACKS_LOCUS_SOURCE, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
      const locusFillFilter = [
        "in",
        ["get", "kind"],
        ["literal", ["kalman-locus-fill", "kalman-locus-fill-out", "kalman-locus-fill-terminal"]],
      ];
      const locusOutlineFilter = [
        "in",
        ["get", "kind"],
        ["literal", ["kalman-locus-outline", "kalman-locus-outline-out", "kalman-locus-outline-terminal"]],
      ];
      // in/out подсветка: точка следующей ноды попала в локус (зелёный) или нет (красный).
      const locusFillColor = [
        "case",
        ["==", ["get", "kind"], "kalman-locus-fill-terminal"],
        "rgba(209, 170, 96, 0.12)",
        ["get", "inLocus"],
        "rgba(168, 147, 94, 0.13)",
        "rgba(186, 92, 64, 0.11)",
      ];
      const locusLineColor = [
        "case",
        ["==", ["get", "kind"], "kalman-locus-outline-terminal"],
        "rgba(221, 178, 92, 0.95)",
        ["get", "inLocus"],
        "rgba(188, 157, 96, 0.86)",
        "rgba(209, 106, 72, 0.9)",
      ];
      if (!map.getLayer(TRACKS_LOCUS_LAYER)) {
        map.addLayer({
          id: TRACKS_LOCUS_LAYER,
          type: "fill",
          source: TRACKS_LOCUS_SOURCE,
          filter: locusFillFilter as never,
          layout: { visibility: "none" },
          paint: {
            "fill-color": locusFillColor as never,
            "fill-outline-color": "rgba(0, 0, 0, 0)",
          } as never,
        });
      } else {
        map.setFilter(TRACKS_LOCUS_LAYER, locusFillFilter as never);
        map.setPaintProperty(TRACKS_LOCUS_LAYER, "fill-color", locusFillColor as never);
      }
      if (!map.getLayer(TRACKS_LOCUS_OUTLINE_LAYER)) {
        map.addLayer({
          id: TRACKS_LOCUS_OUTLINE_LAYER,
          type: "line",
          source: TRACKS_LOCUS_SOURCE,
          filter: locusOutlineFilter as never,
          layout: { visibility: "none" },
          paint: {
            "line-color": locusLineColor as never,
            "line-width": 2,
          } as never,
        });
      } else {
        map.setFilter(TRACKS_LOCUS_OUTLINE_LAYER, locusOutlineFilter as never);
        map.setPaintProperty(TRACKS_LOCUS_OUTLINE_LAYER, "line-color", locusLineColor as never);
        map.setPaintProperty(TRACKS_LOCUS_OUTLINE_LAYER, "line-width", 2);
      }

      // --- Vicinity scopes (между heatmap и places) ---
      if (!map.getSource(VICINITY_SCOPES_SOURCE)) {
        map.addSource(VICINITY_SCOPES_SOURCE, {
          type: "geojson",
          data: vicinityScopesCollection(new Map()),
        });
      }
      if (!map.getLayer(VICINITY_SCOPES_FILL)) {
        map.addLayer({
          id: VICINITY_SCOPES_FILL,
          type: "fill",
          source: VICINITY_SCOPES_SOURCE,
          filter: ["==", ["get", "kind"], "vicinity-scope"],
          paint: {
            "fill-color": ["coalesce", ["get", "color"], "#C58A45"],
            "fill-opacity": ["coalesce", ["get", "fillOpacity"], 0.2],
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
            "line-color": ["coalesce", ["get", "color"], "#C58A45"],
            "line-width": 2,
            "line-opacity": ["coalesce", ["get", "lineOpacity"], 0.85],
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
            "circle-stroke-color": "#f5e8d4",
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
            "text-color": ["coalesce", ["get", "threatColor"], "#c7642d"],
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
            "circle-stroke-color": "#f5e8d4",
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

      interactions?.wire();

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

      map = new maplibre.Map({
        container: containerRef.current,
        style: resolveMapBasemapStyleForTheme(theme$.value) as never,
        center: MAP_INITIAL_VIEW.center,
        zoom: MAP_INITIAL_VIEW.zoom,
        attributionControl: { compact: true },
      });
      interactions = createGeoMapInteractionController({
        getMap: () => map,
        isDisposed: () => disposed,
        popup: maplibre.Popup,
        runtime,
        getHighlightedRegionCode: () => highlightedCode,
      });

      const container = containerRef.current;
      if (container && typeof ResizeObserver !== "undefined") {
        // ResizeObserver в flex-лейауте срабатывает часто (анимации панелей, reflow).
        // Сырой map.resize() на каждый тик churn-ит GL-буфер → пересчёт коллизий →
        // мигание символов (места/иконки). Идём через единый runtime.repaint(): resize
        // ТОЛЬКО при реальном расхождении канваса/контейнера, и коалесим в один кадр.
        let resizeRaf = 0;
        resizeObserver = new ResizeObserver(() => {
          if (disposed || !map || resizeRaf) return;
          resizeRaf = requestAnimationFrame(() => {
            resizeRaf = 0;
            if (disposed || !map) return;
            runtime.repaint();
          });
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

        setupLayers();
        map.resize();

        wireGeoMapDataSync({
          subscriptions: storeSubscriptions,
          destroy$,
          heatmapManualRefresh$,
          canRenderHeatmap: () => !disposed && !!map && geoMapLayers$.value.heatmap,
          renderActiveLayers,
          performInitialAutoFitOnce,
          hideEventsHeatmap,
          applyHeatmapData: (data) => {
            if (!map) return;
            setHeatmapMeta(data.meta);
            runtime.sources.apply(EVENTS_HEATMAP_SOURCE, {
              type: "FeatureCollection",
              features: data.features,
            });
            syncGeoOverlayLayers(map, geoMapLayers$.value);
          },
        });

        wireGeoMapLiveReplayCoordination({
          subscriptions: storeSubscriptions,
          destroy$,
          initialTheme: theme$.value,
          onThemeChange: (theme) => {
            if (!map || disposed) return;
            interactions?.clearPopups();
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
              // Стиль пересоздал слои → форсируем полный проход рендера всех слоёв.
              renderActiveLayers(true);
              applyEventsHeatmapPaint(map, theme);
              syncGeoOverlayLayers(map, geoMapLayers$.value);
              void recreateTracksDeckOverlay();
              if (geoMapLayers$.value.heatmap) heatmapManualRefresh$.next();
            }, {
              fallbackStyle: resolveMapBasemapFallbackForTheme(theme),
            });
          },
          onRegionSelection: (code) => {
            const prev = highlightedCode;
            runtime.selection.apply(prev, code);
            highlightedCode = code;

            if (!code) {
              tryFitOverview(350);
              return;
            }
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
          },
          onTrackSelection: (trackId) => {
            interactions?.onTrackSelection(trackId);
            applyTracksLayers();
          },
        });
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
      runtime.dispose();
      setLocusDebugFocus("none", null);
      tracksDeckOverlay?.dispose();
      tracksDeckOverlay = null;
      interactions?.clearPopups();
      interactions = null;
      disposeMapBootstrap?.();
      resizeObserver?.disconnect();
      resizeObserver = null;
      map?.remove();
    };
  }, [containerRef]);
}
