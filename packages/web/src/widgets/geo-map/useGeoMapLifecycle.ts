/**
 * useGeoMapLifecycle — MapLibre init, RxJS-подписки и side effects карты.
 * UI-оверлеи вынесены в AppShell (GeoMapOverlays); виджет — только canvas.
 */
import { useEffect, useRef, type RefObject } from "react";
import type {
  Map as MapLibreMap,
  MapLayerMouseEvent,
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
  PLACE_CIRCLE_RADIUS_DEFAULT,
  REGION_MAP_SELECTED_FILL_OPACITY,
  REGION_MAP_SELECTED_STROKE_WIDTH,
  REGION_MAP_SELECTION_HALO,
  REGION_MAP_STROKE_WIDTH,
  regionStateLevelColorExpression,
  resolveMapBasemapStyleForTheme,
} from "../../shared/config/mapConfig.service";
import { placesById$, regionsByCode$ } from "../../shared/state/mapStore";
import { geoMapLayers$ } from "../../shared/state/mapLayerStore";
import {
  setHeatmapMeta,
} from "../../shared/state/heatmapStore";
import { clearGeoMapLogs } from "../../shared/state/geoMapLogStore";
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
  REGION_GEOJSON_SOURCE,
  REGIONS_FILL,
  REGIONS_OUTLINE,
  REGIONS_OUTLINE_SOURCE,
  REGIONS_SELECTION,
  REGIONS_SOURCE,
} from "./geoMapLayerIds";
import {
  paintActiveDistricts,
  paintRegionOutlines,
  placesCollection,
  placesToFeatures,
} from "./geoMapPaint";
import { createGeoMapRuntime, whenStyleReady } from "./geoMapRuntime";
import {
  createGeoMapFetchStreams,
  placesStoreTick$,
  regionsStoreTick$,
  type GeoMapEffectHost,
  type GeoMapEffectSignals,
} from "./geoMapEffects";
import { wireLayerFetchStreams } from "./geoMapFetchWire";
import {
  afterStyleChange,
  applyEventsHeatmapPaint,
  buildPlacePopupLines,
  buildRegionPopupLines,
  enforceGeoEntityLayerOrder,
  fitMapView,
  fitOperationalOverview,
  flyToRegion,
  hasChildEntityAtPointer,
  preserveUserLayers,
  syncGeoOverlayLayers,
} from "./geoMapEngine";
import type { GeoJsonCollection, PointFeature, PolygonFeature } from "./geoMapTypes";

/** MapLibre lifecycle: init, fetch-потоки, store-подписки, cleanup. */
export function useGeoMapLifecycle(containerRef: RefObject<HTMLDivElement | null>): void {
  /** Статическая геометрия регионов с API (контуры без paint-свойств). */
  const baseRegionsRef = useRef<GeoJsonCollection | null>(null);
  /** Статическая геометрия активных районов (districts-active-geojson). */
  const baseDistrictsRef = useRef<GeoJsonCollection | null>(null);
  /** Однократный auto-fit уже выполнен (или после появления первых places). */
  const didFitRef = useRef(false);
  /** Число place-точек на прошлом кадре — для fit при переходе 0 → N мест. */
  const lastPlaceFeaturesRef = useRef(0);
  useEffect(() => {
    // --- Локальное состояние эффекта (не React state — живёт только пока смонтирован виджет) ---
    let map: MapLibreMap | null = null;
    /** true после unmount — гасит async-callback и подписки. */
    let disposed = false;
    const destroy$ = new Subject<void>();
    const bootstrap$ = new Subject<void>();
    const resetRegionsDebounce$ = new Subject<void>();
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
    /** Интервал 60 с — пересчёт fade-прозрачности без ожидания нового WS-события. */
    let fadeTicker: ReturnType<typeof setInterval> | undefined;
    let placePopup: Popup | null = null;
    let regionPopup: Popup | null = null;
    let activePlacePopupId: string | null = null;
    /** Пользователь сдвинул карту до прихода geojson — не делаем auto-fit/stop. */
    let userAdjustedViewBeforeGeo = false;
    let geoRecoveryHooked = false;
    // Хранит ссылку на maplibre после динамического import — нужна для Popup в обработчиках
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let maplibreRef: any = null;

    /** Runtime карты: fingerprints, popup LRU, feature-state — один closure на виджет. */
    const runtime = createGeoMapRuntime({
      getMap: () => map,
      isDisposed: () => disposed,
    });

    /** Обзор всех активных регионов/мест — когда сброшен selectedRegion$. */
    const tryFitOverview = (duration: number): void => {
      if (!map || !baseRegionsRef.current || highlightedCode) return;
      whenStyleReady(map, () => {
        if (!map || !baseRegionsRef.current || highlightedCode) return;
        map.stop();
        fitOperationalOverview(map, baseRegionsRef.current, duration);
        requestOverviewFit = false;
      });
    };

    /**
     * Первичный fitBounds: при первой загрузке геометрии или когда places появились после пустого старта.
     * Не срабатывает, если пользователь уже двигал карту до прихода geojson.
     */
    const fitIfNeeded = (
      regionFeatures: PolygonFeature[],
      placeFeatures: PointFeature[],
    ): void => {
      if (!map) return;
      const hadPlaces = lastPlaceFeaturesRef.current > 0;
      const hasPlaces = placeFeatures.length > 0;
      const shouldFit =
        !didFitRef.current
        || (!hadPlaces && hasPlaces);
      if (!shouldFit) return;
      if (regionFeatures.length === 0 && placeFeatures.length === 0) return;
      fitMapView(map, regionFeatures, placeFeatures);
      didFitRef.current = true;
    };

    /** После pan/zoom/idle — перекладывает данные, если MapLibre сбросил слои (редкий race). */
    const scheduleGeoLayerRecovery = (): void => {
      if (!map || geoRecoveryHooked) return;
      geoRecoveryHooked = true;
      const recover = (): void => {
        if (disposed || !map || !baseRegionsRef.current) return;
        applyRegions();
        if (baseDistrictsRef.current) {
          applyDistrictsLayer(baseDistrictsRef.current);
        }
        applyPlacesFadeLayers();
      };
      map.once("idle", recover);
      map.once("moveend", recover);
    };

    /**
     * Перекрашивает контуры регионов из baseRegionsRef + regionsByCode$.
     * force=true — сбрасывает fingerprint (смена темы, fade-тик).
     */
    const applyRegions = (force = false): void => {
      if (!map || !baseRegionsRef.current) return;
      whenStyleReady(map, () => {
        if (!map || !baseRegionsRef.current) return;
        const now = Date.now();
        const paintFingerprint = runtime.regions.buildPaintFingerprint(now);
        if (runtime.regions.shouldSkipPaint(paintFingerprint, force)) {
          return;
        }
        runtime.regions.markPainted(paintFingerprint);
        if (force) {
          runtime.sources.invalidateRegions();
        }
        const painted = paintRegionOutlines(
          baseRegionsRef.current,
          regionsByCode$.value,
          now,
        );
        setGeoMapStats({ regionOutlines: painted.features.length });
        runtime.sources.pushRegions(painted, force, () => {
          if (highlightedCode && map) {
            runtime.selection.setRegionSelected(highlightedCode, true);
          }
        });
        const placeFeatures = placesToFeatures(
          placesById$.value,
          regionsByCode$.value,
          now,
        );
        if (!userAdjustedViewBeforeGeo) {
          fitIfNeeded(painted.features, placeFeatures);
          if (requestOverviewFit) {
            tryFitOverview(0);
          }
        }
      });
    };

    /**
     * Рендерит слой districts-active из уже загруженной геометрии.
     * HTTP — через geoMapEffects (debounce) или loadAndApplyDistricts на map.load.
     */
    const applyDistrictsLayer = (layer: GeoJsonCollection): void => {
      if (!map) return;
      whenStyleReady(map, () => {
        if (!map) return;
        const painted = paintActiveDistricts(
          layer,
          placesById$.value,
          regionsByCode$.value,
          Date.now(),
        );
        runtime.sources.apply(DISTRICTS_SOURCE, painted);
      });
    };

    /** Place-маркеры и place-полигоны с пересчётом fade — без repaint регионов и без HTTP. */
    const applyPlacesFadeLayers = (): void => {
      if (!map) return;
      whenStyleReady(map, () => {
        if (!map) return;
        const now = Date.now();
        const collection = placesCollection(
          placesById$.value,
          regionsByCode$.value,
          now,
        );
        setGeoMapStats({ placeCount: collection.features.length });
        lastPlaceFeaturesRef.current = collection.features.length;
        runtime.sources.apply(PLACES_SOURCE, collection);
        if (baseDistrictsRef.current) {
          const painted = paintActiveDistricts(
            baseDistrictsRef.current,
            placesById$.value,
            regionsByCode$.value,
            now,
          );
          runtime.sources.apply(DISTRICTS_SOURCE, painted);
        }
      });
    };

    /**
     * Полное обновление places после mount/load: маркеры + опциональный fit.
     */
    const applyPlaces = (): void => {
      applyPlacesFadeLayers();
      if (!map || !baseRegionsRef.current) return;
      whenStyleReady(map, () => {
        if (!map || !baseRegionsRef.current) return;
        const collection = placesCollection(
          placesById$.value,
          regionsByCode$.value,
        );
        const painted = paintRegionOutlines(
          baseRegionsRef.current,
          regionsByCode$.value,
          Date.now(),
        );
        if (highlightedCode) {
          runtime.selection.setRegionSelected(highlightedCode, true);
        }
        if (!userAdjustedViewBeforeGeo) {
          fitIfNeeded(painted.features, collection.features);
          if (requestOverviewFit) {
            tryFitOverview(0);
          }
        }
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

      // --- Теплокарта событий (под контурами) ---
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
            "circle-radius": ["coalesce", ["get", "radius"], PLACE_CIRCLE_RADIUS_DEFAULT],
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
       * Hover по региону: tooltip с уровнем и последним событием.
       * Под place/районом — не показываем (дочерняя сущность перекрывает регион).
       */
      const onRegionHover = (event: MapLayerMouseEvent): void => {
        if (!map) return;
        if (hasChildEntityAtPointer(map, event.point)) {
          regionPopup?.remove();
          regionPopup = null;
          return;
        }
        map.getCanvas().style.cursor = "pointer";
        const code = event.features?.[0]?.properties?.regionCode;
        if (typeof code !== "string" || !code) return;
        regionPopup?.remove();
        regionPopup = new ml.Popup({
          closeButton: false,
          closeOnClick: false,
          className: "geo-map-region-popup",
          offset: 12,
        })
          .setLngLat(event.lngLat)
          .setText(buildRegionPopupLines(code).join("\n"))
          .addTo(map);
      };

      /** Уход курсора с региона — скрываем region popup. */
      const onRegionHoverEnd = (): void => {
        if (!map) return;
        map.getCanvas().style.cursor = "";
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

      // До прихода geojson — запоминаем ручной pan/zoom, чтобы не сбивать камеру auto-fit.
      map.on("movestart", () => {
        if (!baseRegionsRef.current) {
          userAdjustedViewBeforeGeo = true;
        }
      });

      if (baseRegionsRef.current) {
        applyRegions();
      }
      if (baseDistrictsRef.current) {
        applyDistrictsLayer(baseDistrictsRef.current);
      }
      applyPlacesFadeLayers();
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

      // Карта и стиль готовы — слои, первая загрузка данных, RxJS-подписки.
      map.on("load", () => {
        if (!map) return;

        setupLayersAndHandlers();

        const effectSignals: GeoMapEffectSignals = {
          bootstrap$,
          resetRegionsDebounce$,
          heatmapManualRefresh$,
        };
        const effectHost: GeoMapEffectHost = {
          signals: effectSignals,
          hasRegionsGeometry: () => baseRegionsRef.current !== null,
        };
        const fetchStreams = createGeoMapFetchStreams(effectHost);

        wireLayerFetchStreams({
          sub: storeSubscriptions,
          destroy$,
          layerId: "regions",
          streams: fetchStreams.regions,
          fallbackError: "Ошибка загрузки геометрии",
          onData: (layer) => {
            if (disposed || !map) return;
            baseRegionsRef.current = layer;
            applyRegions();
            scheduleGeoLayerRecovery();
          },
        });

        wireLayerFetchStreams({
          sub: storeSubscriptions,
          destroy$,
          layerId: "districts",
          streams: fetchStreams.districts,
          fallbackError: "Ошибка загрузки районов",
          onData: (layer) => {
            if (disposed || !map) return;
            baseDistrictsRef.current = layer;
            applyDistrictsLayer(layer);
          },
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
          },
        });

        storeSubscriptions.add(
          regionsStoreTick$(effectSignals).pipe(takeUntil(destroy$)).subscribe(() => {
            if (disposed || !baseRegionsRef.current) return;
            applyRegions();
          }),
        );

        storeSubscriptions.add(
          placesStoreTick$().pipe(takeUntil(destroy$)).subscribe(() => {
            if (!disposed) applyPlacesFadeLayers();
          }),
        );

        storeSubscriptions.add(
          geoMapLayers$.pipe(takeUntil(destroy$)).subscribe((layers) => {
            if (!map || disposed) return;
            syncGeoOverlayLayers(map, layers);
            if (!layers.heatmap) hideEventsHeatmap();
          }),
        );

        applyPlaces();
        bootstrap$.next();

        // appliedTheme хранит тему, уже применённую к карте —
        // реагируем только на реальное изменение, не на начальный emit BehaviorSubject.
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
            if (baseDistrictsRef.current) {
              applyDistrictsLayer(baseDistrictsRef.current);
            }
            applyPlacesFadeLayers();
            applyEventsHeatmapPaint(map, theme);
            syncGeoOverlayLayers(map, geoMapLayers$.value);
            if (geoMapLayers$.value.heatmap) heatmapManualRefresh$.next();
          });
          }),
        );

        // Выбор региона: feature-state + flyTo / overview fit.
        storeSubscriptions.add(
          selectedRegion$.pipe(takeUntil(destroy$)).subscribe((code) => {
          resetRegionsDebounce$.next();
          const prev = highlightedCode;
          runtime.selection.apply(prev, code);
          highlightedCode = code;

          if (!code) {
            requestOverviewFit = true;
            tryFitOverview(350);
            return;
          }
          requestOverviewFit = false;
          if (!map || !baseRegionsRef.current) return;
          if (code === prev) return;

          whenStyleReady(map, () => {
            if (!map || !baseRegionsRef.current) return;
            map.stop();
            const animate = prev === null;
            flyToRegion(map, code, baseRegionsRef.current, animate ? 320 : 0);
          });
          }),
        );

        // Снапшот мог прийти до mount виджета — повторно кладём точки на карту.
        if (placesById$.value.size > 0) {
          map.once("idle", () => applyPlaces());
        }

        // Тик 60с: пересчёт fade для регионов, place-полигонов и маркеров.
        fadeTicker = setInterval(() => {
          if (disposed) return;
          applyRegions(false);
          applyPlacesFadeLayers();
        }, 60_000);
      });
    })();

    // --- Cleanup: таймеры, подписки, popup, кэши, destroy map ---
    return () => {
      disposed = true;
      destroy$.next();
      destroy$.complete();
      storeSubscriptions.unsubscribe();
      clearGeoMapLogs();
      resetAllGeoMapLayerFetchStatus();
      resetGeoMapStats();
      runtime.dispose();
      clearInterval(fadeTicker);
      placePopup?.remove();
      placePopup = null;
      regionPopup?.remove();
      regionPopup = null;
      map?.remove();
    };
  }, [containerRef]);
}
