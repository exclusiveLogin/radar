import { useEffect, useRef, useState } from "react";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapLayerMouseEvent,
  Popup,
} from "maplibre-gl";
import type { Subscription } from "rxjs";
import type { MapPlaceSnapshot, MapRegionSnapshot, StateLevel } from "@radar/shared";
import { Panel } from "../../shared/ds";
import { mapApi } from "../../shared/api/mapApi";
import { regionFadeFactor } from "../../shared/utils/regionFade";
import {
  DISTRICT_MAP_FILL_OPACITY,
  DISTRICT_MAP_MIN_ZOOM,
  DISTRICT_MAP_STROKE_WIDTH,
  LEVEL_COLORS,
  LEVEL_LABELS,
  MAP_INITIAL_VIEW,
  PLACE_CIRCLE_RADIUS_DEFAULT,
  PLACE_CIRCLE_RADIUS_DISTRICT,
  REGION_MAP_FILL_OPACITY,
  REGION_MAP_INSET_FACTOR,
  REGION_MAP_SELECTED_FILL_OPACITY,
  REGION_MAP_SELECTED_STROKE_WIDTH,
  REGION_MAP_SELECTION_HALO,
  REGION_MAP_STROKE_WIDTH,
  resolveMapBasemapStyle,
} from "../../shared/config/mapConfig.service";
import { formatDateTime } from "../../shared/format/dateTime";
import { effectivePlaceLevel, isPlaceVisibleOnMap, isRegionVisibleOnMap } from "../../shared/state/derivations";
import { derivedRegionCodes$, placesById$, regionsByCode$ } from "../../shared/state/mapStore";
import { selectRegion, selectedRegion$ } from "../../shared/state/selectionStore";
import { stateChangesFeed$ } from "../../shared/state/stateChangesFeedStore";
import type { WidgetProps } from "../widgetProps";
import { insetRegionGeometry } from "./regionInsetOutline";

const REGIONS_SOURCE = "regions";
const REGIONS_OUTLINE_SOURCE = "regions-outline-inset";
const REGIONS_FILL = "regions-fill";
const REGIONS_OUTLINE = "regions-outline";
const REGIONS_SELECTION = "regions-selection";
/** Слой активных районов (district/city_district) из geo_feature — рисуется над регионами. */
const DISTRICTS_SOURCE = "districts-active";
const DISTRICTS_FILL = "districts-active-fill";
const DISTRICTS_OUTLINE = "districts-active-outline";
const PLACES_SOURCE = "places";
const PLACES_LAYER = "places-circles";

/** promoteId — быстрый feature-state для выделения без полного setData. */
const REGION_GEOJSON_SOURCE = {
  type: "geojson" as const,
  promoteId: "regionCode",
};

const FEATURE_SELECTED = ["boolean", ["feature-state", "selected"], false] as const;

/** Place-слой выше fill региона — при hover на точку не показываем тултип области. */
function hasPlaceAtPointer(map: MapLibreMap, point: { x: number; y: number }): boolean {
  return map.queryRenderedFeatures(point, { layers: [PLACES_LAYER] }).length > 0;
}

type PointFeature = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: Record<string, string | number>;
};

type PolygonFeature = {
  type: "Feature";
  id?: string;
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, string | number>;
};

type GeoJsonCollection = {
  type: "FeatureCollection";
  features: PolygonFeature[];
};

/**
 * Контуры регионов: все уровни, включая grey; цвет по stateLevel из снапшота.
 * fillOpacity — затухание пропорционально времени с момента последнего события (3ч окно).
 * Базовая геометрия загружается один раз; при WS меняются только properties.
 */
function paintRegionOutlines(
  base: GeoJsonCollection,
  regions: Map<string, MapRegionSnapshot>,
  now: number,
): GeoJsonCollection {
  const features: PolygonFeature[] = [];
  for (const feature of base.features) {
    const code = String(feature.properties.regionCode ?? "");
    const region = regions.get(code);
    if (!region || !isRegionVisibleOnMap(region)) continue;

    const stateLevel = region.stateLevel as StateLevel;
    const fade = regionFadeFactor(region.statusEventAt, now);
    features.push({
      ...feature,
      properties: {
        ...feature.properties,
        regionCode: code,
        stateLevel,
        color: LEVEL_COLORS[stateLevel],
        kind: "region",
        fillOpacity: REGION_MAP_FILL_OPACITY * fade,
        lineOpacity: 0.95 * fade,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

/** Мгновенное выделение: без пересборки GeoJSON (setData на тысячах полигонов — медленно). */
function setRegionFeatureSelected(
  map: MapLibreMap,
  regionCode: string,
  selected: boolean,
): void {
  for (const source of [REGIONS_SOURCE, REGIONS_OUTLINE_SOURCE]) {
    try {
      map.setFeatureState({ source, id: regionCode }, { selected });
    } catch {
      // регион ещё не в источнике
    }
  }
}

function applyRegionSelection(
  map: MapLibreMap,
  prev: string | null,
  next: string | null,
): void {
  if (prev && prev !== next) setRegionFeatureSelected(map, prev, false);
  if (next) setRegionFeatureSelected(map, next, true);
}

/** Line-слой: inset-контур (строго внутри полигона, без line-offset). */
function paintRegionInsetOutlines(
  painted: GeoJsonCollection,
): GeoJsonCollection {
  return {
    type: "FeatureCollection",
    features: painted.features.map((feature) => ({
      ...feature,
      geometry: insetRegionGeometry(
        feature.geometry as { type: string; coordinates: unknown },
        REGION_MAP_INSET_FACTOR,
      ) as PolygonFeature["geometry"],
    })),
  };
}

const DISTRICT_KINDS = new Set(["district", "city_district"]);

/** Точки places: маркер-кружок; радиус меньше для district (у них есть polygon-слой). */
function placesToFeatures(
  places: Map<string, MapPlaceSnapshot>,
  regions: Map<string, MapRegionSnapshot>,
): PointFeature[] {
  return [...places.values()]
    .filter((place) => isPlaceVisibleOnMap(place, regions))
    .map((place) => {
      const regionLevel = regions.get(place.regionCode)?.stateLevel ?? "grey";
      const level = effectivePlaceLevel(place.stateLevel, regionLevel);
      return {
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [place.lon, place.lat],
        },
        properties: {
          kind: "place",
          placeId: place.placeId,
          placeName: place.placeName,
          regionCode: place.regionCode,
          statusCode: place.statusCode,
          stateLabel: LEVEL_LABELS[level],
          color: LEVEL_COLORS[level],
          // Для district дублируется полигоном — маленький кружок-якорь.
          radius: DISTRICT_KINDS.has(place.kind ?? "") ? PLACE_CIRCLE_RADIUS_DISTRICT : PLACE_CIRCLE_RADIUS_DEFAULT,
        },
      };
    });
}

/**
 * Активные полигоны районов: из базовой геометрии geo_feature оставляем только те,
 * которые присутствуют в снапшоте places (есть статус). Цвет берётся из place.stateLevel.
 */
function paintActiveDistricts(
  base: GeoJsonCollection,
  places: Map<string, MapPlaceSnapshot>,
  regions: Map<string, MapRegionSnapshot>,
): GeoJsonCollection {
  // Индекс geoFeatureId → place для быстрого поиска.
  const byGeoFeatureId = new Map<string, MapPlaceSnapshot>();
  for (const place of places.values()) {
    if (place.geoFeatureId && isPlaceVisibleOnMap(place, regions)) {
      byGeoFeatureId.set(place.geoFeatureId, place);
    }
  }

  const features: PolygonFeature[] = [];
  for (const feature of base.features) {
    const featureId = String(feature.id ?? feature.properties.geoFeatureId ?? "");
    const place = byGeoFeatureId.get(featureId);
    if (!place) continue;

    const regionLevel = regions.get(place.regionCode)?.stateLevel ?? "grey";
    const level = effectivePlaceLevel(place.stateLevel, regionLevel);
    features.push({
      ...feature,
      properties: {
        ...feature.properties,
        color: LEVEL_COLORS[level],
        placeId: place.placeId,
        placeName: place.placeName,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

/** Выполняет fn, когда стиль MapLibre готов (иначе setData теряется). */
function whenStyleReady(
  map: MapLibreMap,
  fn: () => void,
): void {
  if (map.isStyleLoaded()) {
    fn();
    return;
  }
  map.once("load", fn);
}

function placesCollection(
  places: Map<string, MapPlaceSnapshot>,
  regions: Map<string, MapRegionSnapshot>,
) {
  return {
    type: "FeatureCollection" as const,
    features: placesToFeatures(places, regions),
  };
}

function fitMapView(
  map: MapLibreMap,
  regionFeatures: PolygonFeature[],
  placeFeatures: PointFeature[],
  duration = 0,
): void {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  const extend = (lon: number, lat: number): void => {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  };

  const walkCoords = (coords: unknown): void => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      extend(coords[0], coords[1]);
      return;
    }
    for (const part of coords) walkCoords(part);
  };

  for (const feature of regionFeatures) {
    walkCoords(feature.geometry.coordinates);
  }
  for (const feature of placeFeatures) {
    const [lon, lat] = feature.geometry.coordinates;
    extend(lon, lat);
  }

  if (!Number.isFinite(minLon)) {
    map.flyTo({
      center: MAP_INITIAL_VIEW.center,
      zoom: MAP_INITIAL_VIEW.zoom,
      duration,
    });
    return;
  }
  map.fitBounds(
    [
      [minLon, minLat],
      [maxLon, maxLat],
    ],
    { padding: 48, maxZoom: 7, duration },
  );
}

/** Обзор активных регионов и мест (сброс фильтра). */
function fitOperationalOverview(
  map: MapLibreMap,
  base: GeoJsonCollection,
  duration: number,
): void {
  const painted = paintRegionOutlines(base, regionsByCode$.value, Date.now());
  const placeFeatures = placesToFeatures(
    placesById$.value,
    regionsByCode$.value,
  );
  fitMapView(map, painted.features, placeFeatures, duration);
}

/** Центрирует карту на выбранном регионе (selectedRegion$). */
function flyToRegion(
  map: MapLibreMap,
  regionCode: string,
  base: GeoJsonCollection,
  duration: number,
): void {
  const feature = base.features.find(
    (row) => String(row.properties.regionCode ?? "") === regionCode,
  );
  if (!feature) {
    const region = regionsByCode$.value.get(regionCode);
    if (region?.centroidLat != null && region?.centroidLon != null) {
      map.flyTo({
        center: [region.centroidLon, region.centroidLat],
        zoom: 6,
        duration,
      });
    }
    return;
  }

  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  const extend = (lon: number, lat: number): void => {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  };

  const walkCoords = (coords: unknown): void => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      extend(coords[0], coords[1]);
      return;
    }
    for (const part of coords) walkCoords(part);
  };

  walkCoords(feature.geometry.coordinates);
  if (!Number.isFinite(minLon)) return;

  map.fitBounds(
    [
      [minLon, minLat],
      [maxLon, maxLat],
    ],
    { padding: 72, maxZoom: 8, duration },
  );
}

/**
 * Гео-карта: регион (заливка, тусклее) → район (polygon, насыщеннее) → place-маркер (точка).
 * Слои отсортированы по точности геопривязки: субъект внизу, конкретный НП сверху.
 */
export function GeoMapWidget(_props: WidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const baseRegionsRef = useRef<GeoJsonCollection | null>(null);
  const baseDistrictsRef = useRef<GeoJsonCollection | null>(null);
  const didFitRef = useRef(false);
  const lastPlaceFeaturesRef = useRef(0);
  const [regionOutlines, setRegionOutlines] = useState(0);
  const [placeCount, setPlaceCount] = useState(0);
  const [geoError, setGeoError] = useState<string | null>(null);

  useEffect(() => {
    let map: MapLibreMap | null = null;
    let disposed = false;
    let unsubRegions: Subscription | undefined;
    let unsubPlaces: Subscription | undefined;
    let unsubSelected: Subscription | undefined;
    /**
     * Инициализируем null, чтобы первый emit BehaviorSubject всегда обрабатывался
     * (иначе code === prev → early return → flyToRegion не вызывается).
     */
    let highlightedCode: string | null = null;
    /** Сброс фильтра до загрузки контуров — догоняем fit после regions-geojson. */
    let requestOverviewFit = !selectedRegion$.value;
    let geoReloadTimer: ReturnType<typeof setTimeout> | undefined;
    let fadeTicker: ReturnType<typeof setInterval> | undefined;
    let placePopup: Popup | null = null;
    let regionPopup: Popup | null = null;

    const tryFitOverview = (duration: number): void => {
      if (!map || !baseRegionsRef.current || highlightedCode) return;
      whenStyleReady(map, () => {
        if (!map || !baseRegionsRef.current || highlightedCode) return;
        map.stop();
        fitOperationalOverview(map, baseRegionsRef.current, duration);
        requestOverviewFit = false;
      });
    };

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

    const applyRegions = (): void => {
      if (!map || !baseRegionsRef.current) return;
      whenStyleReady(map, () => {
        if (!map || !baseRegionsRef.current) return;
        const painted = paintRegionOutlines(
          baseRegionsRef.current,
          regionsByCode$.value,
          Date.now(),
        );
        setRegionOutlines(painted.features.length);
        const fillSource = map.getSource(REGIONS_SOURCE) as
          | GeoJSONSource
          | undefined;
        fillSource?.setData(painted as never);
        const outlineSource = map.getSource(REGIONS_OUTLINE_SOURCE) as
          | GeoJSONSource
          | undefined;
        outlineSource?.setData(paintRegionInsetOutlines(painted) as never);
        if (highlightedCode) {
          setRegionFeatureSelected(map, highlightedCode, true);
        }
        const placeFeatures = placesToFeatures(
          placesById$.value,
          regionsByCode$.value,
        );
        fitIfNeeded(painted.features, placeFeatures);
        if (requestOverviewFit) {
          tryFitOverview(0);
        }
      });
    };

    /**
     * Загружает активные районы с сервера и сразу рендерит.
     * Вызывается при каждом обновлении places — ответ маленький (единицы объектов).
     * Цвет берётся из place.stateLevel через `paintActiveDistricts`.
     */
    const loadAndApplyDistricts = (): void => {
      if (!map) return;
      void mapApi.activeDistrictsGeoJson().then((layer) => {
        if (disposed || !map) return;
        baseDistrictsRef.current = layer as GeoJsonCollection;
        whenStyleReady(map, () => {
          if (!map || !baseDistrictsRef.current) return;
          const painted = paintActiveDistricts(
            baseDistrictsRef.current,
            placesById$.value,
            regionsByCode$.value,
          );
          const source = map.getSource(DISTRICTS_SOURCE) as GeoJSONSource | undefined;
          source?.setData(painted as never);
        });
      }).catch((err: unknown) => {
        console.error("[GeoMapWidget] districts-active-geojson", err);
      });
    };

    const applyPlaces = (): void => {
      if (!map) return;
      whenStyleReady(map, () => {
        if (!map) return;
        const collection = placesCollection(
          placesById$.value,
          regionsByCode$.value,
        );
        setPlaceCount(collection.features.length);
        lastPlaceFeaturesRef.current = collection.features.length;
        const source = map.getSource(PLACES_SOURCE) as
          | GeoJSONSource
          | undefined;
        source?.setData(collection as never);

        loadAndApplyDistricts();

        if (baseRegionsRef.current) {
          const painted = paintRegionOutlines(
            baseRegionsRef.current,
            regionsByCode$.value,
            Date.now(),
          );
          if (highlightedCode) {
            setRegionFeatureSelected(map, highlightedCode, true);
          }
          fitIfNeeded(painted.features, collection.features);
          if (requestOverviewFit) {
            tryFitOverview(0);
          }
        }
      });
    };

    const loadRegionGeometry = (): void => {
      void mapApi
        .regionsGeoJson()
        .then((layer) => {
          if (disposed) return;
          baseRegionsRef.current = layer as GeoJsonCollection;
          setGeoError(null);
          applyRegions();
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "Ошибка загрузки геометрии";
          setGeoError(message);
          console.error("[GeoMapWidget] regions-geojson", error);
        });
    };


    const scheduleMapRefresh = (): void => {
      clearTimeout(geoReloadTimer);
      geoReloadTimer = setTimeout(() => {
        if (baseRegionsRef.current) {
          applyRegions();
          applyPlaces();
          return;
        }
        loadRegionGeometry();
      }, 300);
    };

    void (async () => {
      const maplibre = (await import("maplibre-gl")).default;
      await import("maplibre-gl/dist/maplibre-gl.css");
      if (disposed || !containerRef.current) return;

      map = new maplibre.Map({
        container: containerRef.current,
        style: resolveMapBasemapStyle() as never,
        center: MAP_INITIAL_VIEW.center,
        zoom: MAP_INITIAL_VIEW.zoom,
        attributionControl: { compact: true },
      });

      map.on("load", () => {
        if (!map) return;

        map.addSource(REGIONS_SOURCE, {
          ...REGION_GEOJSON_SOURCE,
          data: { type: "FeatureCollection", features: [] },
        });
        map.addSource(REGIONS_OUTLINE_SOURCE, {
          ...REGION_GEOJSON_SOURCE,
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: REGIONS_FILL,
          type: "fill",
          source: REGIONS_SOURCE,
          filter: ["==", ["get", "kind"], "region"],
          paint: {
            "fill-color": ["coalesce", ["get", "color"], LEVEL_COLORS.grey],
            "fill-opacity": [
              "case",
              FEATURE_SELECTED,
              REGION_MAP_SELECTED_FILL_OPACITY,
              ["coalesce", ["get", "fillOpacity"], REGION_MAP_FILL_OPACITY],
            ],
          },
        });
        map.addLayer({
          id: REGIONS_OUTLINE,
          type: "line",
          source: REGIONS_OUTLINE_SOURCE,
          filter: ["==", ["get", "kind"], "region"],
          paint: {
            "line-color": ["coalesce", ["get", "color"], LEVEL_COLORS.grey],
            "line-width": [
              "case",
              FEATURE_SELECTED,
              REGION_MAP_SELECTED_STROKE_WIDTH,
              REGION_MAP_STROKE_WIDTH,
            ],
            "line-opacity": ["coalesce", ["get", "lineOpacity"], 0.95],
          },
        });
        map.addLayer({
          id: REGIONS_SELECTION,
          type: "line",
          source: REGIONS_OUTLINE_SOURCE,
          filter: [
            "all",
            ["==", ["get", "kind"], "region"],
            FEATURE_SELECTED,
          ],
          paint: {
            "line-color": REGION_MAP_SELECTION_HALO,
            "line-width": REGION_MAP_SELECTED_STROKE_WIDTH + 1.5,
            "line-opacity": 0.9,
          },
        });

        // --- Слой районов: между регионами и маркерами (minzoom: не загромождать overview) ---
        map.addSource(DISTRICTS_SOURCE, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: DISTRICTS_FILL,
          type: "fill",
          source: DISTRICTS_SOURCE,
          minzoom: DISTRICT_MAP_MIN_ZOOM,
          paint: {
            "fill-color": ["coalesce", ["get", "color"], LEVEL_COLORS.yellow],
            "fill-opacity": DISTRICT_MAP_FILL_OPACITY,
          },
        });
        map.addLayer({
          id: DISTRICTS_OUTLINE,
          type: "line",
          source: DISTRICTS_SOURCE,
          minzoom: DISTRICT_MAP_MIN_ZOOM - 1,
          paint: {
            "line-color": ["coalesce", ["get", "color"], LEVEL_COLORS.yellow],
            "line-width": DISTRICT_MAP_STROKE_WIDTH,
            "line-opacity": 0.85,
          },
        });

        // --- Маркеры places: поверх всего ---
        map.addSource(PLACES_SOURCE, {
          type: "geojson",
          data: placesCollection(new Map(), new Map()),
        });
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
            "circle-opacity": 1,
          },
        });
        if (map.getLayer(PLACES_LAYER)) {
          map.moveLayer(PLACES_LAYER);
        }

        const onPick = (event: MapLayerMouseEvent): void => {
          const props = event.features?.[0]?.properties;
          const code = props?.regionCode;
          if (typeof code === "string") {
            // Повторный клик по тому же региону сбрасывает выбор (toggle)
            selectRegion(code === highlightedCode ? null : code);
          }
        };

        const onPlaceHover = (event: MapLayerMouseEvent): void => {
          if (!map) return;
          regionPopup?.remove();
          regionPopup = null;
          map.getCanvas().style.cursor = "pointer";
          const props = event.features?.[0]?.properties;
          const name = props?.placeName;
          if (typeof name !== "string" || !name) return;

          const regionCode = props?.regionCode;
          const stateLabel = props?.stateLabel;
          const statusCode = props?.statusCode;
          const lines = [
            name,
            typeof regionCode === "string" ? regionCode : null,
            typeof stateLabel === "string" ? stateLabel : null,
            typeof statusCode === "string" ? statusCode : null,
          ].filter(Boolean);

          placePopup?.remove();
          placePopup = new maplibre.Popup({
            closeButton: false,
            closeOnClick: false,
            className: "geo-map-place-popup",
            offset: 12,
          })
            .setLngLat(event.lngLat)
            .setText(lines.join("\n"))
            .addTo(map);
        };

        const onPlaceHoverEnd = (): void => {
          if (!map) return;
          map.getCanvas().style.cursor = "";
          placePopup?.remove();
          placePopup = null;
        };

        /**
         * Строит текст тултипа для региона с eventType, derived-меткой и rawText.
         * Читаем storeы напрямую (не ref) — внутри closure useEffect значения актуальны.
         */
        const buildRegionPopupLines = (code: string): string[] => {
          const region = regionsByCode$.value.get(code);
          const isDerived = derivedRegionCodes$.value.has(code);
          const recentEvent = stateChangesFeed$.value.find((e) => e.regionCodes.includes(code));
          const levelLabel = region ? LEVEL_LABELS[region.stateLevel] : null;
          return [
            `${code} — ${region?.name ?? code}`,
            isDerived && levelLabel
              ? `${levelLabel} (производный)`
              : levelLabel
                ? `${levelLabel} · ×${region?.activity ?? 0}`
                : null,
            recentEvent?.eventType ? `тип: ${recentEvent.eventType}` : null,
            region?.statusEventAt ? `статус с ${formatDateTime(region.statusEventAt)}` : null,
            recentEvent?.rawText ? recentEvent.rawText.slice(0, 80) : null,
          ].filter((l): l is string => !!l);
        };

        const onRegionHover = (event: MapLayerMouseEvent): void => {
          if (!map) return;
          if (hasPlaceAtPointer(map, event.point)) {
            regionPopup?.remove();
            regionPopup = null;
            return;
          }
          map.getCanvas().style.cursor = "pointer";
          const code = event.features?.[0]?.properties?.regionCode;
          if (typeof code !== "string" || !code) return;

          regionPopup?.remove();
          regionPopup = new maplibre.Popup({
            closeButton: false,
            closeOnClick: false,
            className: "geo-map-region-popup",
            offset: 12,
          })
            .setLngLat(event.lngLat)
            .setText(buildRegionPopupLines(code).join("\n"))
            .addTo(map);
        };

        const onRegionHoverEnd = (): void => {
          if (!map) return;
          map.getCanvas().style.cursor = "";
          regionPopup?.remove();
          regionPopup = null;
        };

        map.on("click", REGIONS_FILL, onPick);
        map.on("click", REGIONS_OUTLINE, onPick);
        map.on("click", PLACES_LAYER, onPick);
        map.on("mouseenter", PLACES_LAYER, onPlaceHover);
        map.on("mousemove", PLACES_LAYER, onPlaceHover);
        map.on("mouseleave", PLACES_LAYER, onPlaceHoverEnd);
        map.on("mousemove", REGIONS_FILL, onRegionHover);
        map.on("mouseleave", REGIONS_FILL, onRegionHoverEnd);

        loadRegionGeometry();
        loadAndApplyDistricts();
        applyPlaces();

        unsubRegions = regionsByCode$.subscribe(() => scheduleMapRefresh());
        unsubPlaces = placesById$.subscribe(() => {
          applyPlaces();
          loadAndApplyDistricts();
        });
        unsubSelected = selectedRegion$.subscribe((code) => {
          clearTimeout(geoReloadTimer);
          const prev = highlightedCode;
          if (map) {
            applyRegionSelection(map, prev, code);
          }
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
        });

        // Снапшот мог прийти до mount виджета — повторно кладём точки на карту.
        if (placesById$.value.size > 0) {
          map.once("idle", () => applyPlaces());
        }

        // Тик 60с для пересчёта затухания яркости заливок (now → fillOpacity в GeoJSON).
        fadeTicker = setInterval(() => {
          if (!disposed) applyRegions();
        }, 60_000);
      });
    })();

    return () => {
      disposed = true;
      clearTimeout(geoReloadTimer);
      clearInterval(fadeTicker);
      placePopup?.remove();
      placePopup = null;
      regionPopup?.remove();
      regionPopup = null;
      unsubRegions?.unsubscribe();
      unsubPlaces?.unsubscribe();
      unsubSelected?.unsubscribe();
      map?.remove();
    };
  }, []);

  return (
    <Panel variant="bare" className="geo-map-panel">
      {!geoError && (regionOutlines > 0 || placeCount > 0) && (
        <div className="geo-map-panel__stats">
          Контуров: {regionOutlines} · мест: {placeCount}
        </div>
      )}
      {geoError && (
        <div className="geo-map-panel__stats">Геометрия: {geoError}</div>
      )}
      {regionOutlines === 0 && placeCount === 0 && !geoError && (
        <div className="geo-map-panel__stats">
          Нет активных регионов/мест
        </div>
      )}
      <div ref={containerRef} className="geo-map-panel__canvas" />
    </Panel>
  );
}
