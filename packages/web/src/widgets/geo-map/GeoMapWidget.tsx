import { useEffect, useRef, useState } from "react";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapLayerMouseEvent,
  Popup,
} from "maplibre-gl";
import type { Subscription } from "rxjs";
import type {
  MapPlaceSnapshot,
  MapRegionSnapshot,
  SourceMessage,
  StateLevel,
} from "@radar/shared";
import { Panel } from "../../shared/ds";
import { mapApi } from "../../shared/api/mapApi";
import { geoMapFillOpacity, geoMapStrokeOpacity } from "../../shared/utils/regionFade";
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
  GEO_MAP_STROKE_FILL_RATIO,
  LEVEL_COLORS,
  LEVEL_LABELS,
  MAP_INITIAL_VIEW,
  PLACE_CIRCLE_RADIUS_DEFAULT,
  PLACE_CIRCLE_RADIUS_DISTRICT,
  REGION_MAP_INSET_FACTOR,
  REGION_MAP_SELECTED_FILL_OPACITY,
  REGION_MAP_SELECTED_STROKE_WIDTH,
  REGION_MAP_SELECTION_HALO,
  REGION_MAP_STROKE_WIDTH,
  regionStateLevelColorExpression,
  resolveMapBasemapStyleForTheme,
} from "../../shared/config/mapConfig.service";
import { formatDateTime } from "../../shared/format/dateTime";
import { effectivePlaceLevel, isPlaceVisibleOnMap, isRegionVisibleOnMap } from "../../shared/state/derivations";
import { derivedRegionCodes$, historicalAsOf$, placesById$, regionsByCode$ } from "../../shared/state/mapStore";
import {
  geoMapLayers$,
  type GeoMapLayerId,
} from "../../shared/state/mapLayerStore";
import {
  heatmapPeriod$,
  setHeatmapLoading,
  setHeatmapMeta,
} from "../../shared/state/heatmapStore";
import { selectRegion, selectedRegion$ } from "../../shared/state/selectionStore";
import { stateChangesFeed$ } from "../../shared/state/stateChangesFeedStore";
import { theme$ } from "../../shared/state/themeStore";
import type { ThemeMode } from "../../shared/state/themeStore";
import type { WidgetProps } from "../widgetProps";
import { insetRegionGeometry } from "./regionInsetOutline";

const REGIONS_SOURCE = "regions";
const REGIONS_OUTLINE_SOURCE = "regions-outline-inset";
const REGIONS_FILL = "regions-fill";
const REGIONS_OUTLINE = "regions-outline";
/** Белый halo поверх цветного контура — только для выбранного региона (opacity + feature-state). */
const REGIONS_SELECTION = "regions-selection";

/** Слой активных place-полигонов (geo_feature) — рисуется над регионами. */
const DISTRICTS_SOURCE = "districts-active";
const DISTRICTS_FILL = "districts-active-fill";
const DISTRICTS_OUTLINE = "districts-active-outline";
const PLACES_SOURCE = "places";
const PLACES_LAYER = "places-circles";

/** Z-order: heatmap → region → district → place (moveLayer без beforeId — наверх стека). */
const GEO_ENTITY_LAYER_ORDER = [
  EVENTS_HEATMAP_LAYER,
  EVENTS_HEATMAP_POINTS_LAYER,
  REGIONS_FILL,
  REGIONS_OUTLINE,
  REGIONS_SELECTION,
  DISTRICTS_FILL,
  DISTRICTS_OUTLINE,
  PLACES_LAYER,
] as const;

function enforceGeoEntityLayerOrder(map: MapLibreMap): void {
  for (const layerId of GEO_ENTITY_LAYER_ORDER) {
    if (map.getLayer(layerId)) map.moveLayer(layerId);
  }
}

/** Применяет paint теплокарты (heatmap + points) под текущую тему. */
function applyEventsHeatmapPaint(map: MapLibreMap, theme: ThemeMode): void {
  if (map.getLayer(EVENTS_HEATMAP_LAYER)) {
    for (const [key, value] of Object.entries(eventsHeatmapPaint(theme))) {
      map.setPaintProperty(EVENTS_HEATMAP_LAYER, key, value);
    }
  }
  if (map.getLayer(EVENTS_HEATMAP_POINTS_LAYER)) {
    for (const [key, value] of Object.entries(eventsHeatmapPointsPaint(theme))) {
      map.setPaintProperty(EVENTS_HEATMAP_POINTS_LAYER, key, value);
    }
  }
}

/** SSOT: toggle mapLayerStore → id слоёв MapLibre. */
const GEO_OVERLAY_LAYERS: Record<
  Exclude<GeoMapLayerId, "timeline">,
  readonly string[]
> = {
  regions: [REGIONS_FILL, REGIONS_OUTLINE, REGIONS_SELECTION],
  districts: [DISTRICTS_FILL, DISTRICTS_OUTLINE],
  places: [PLACES_LAYER],
  heatmap: [EVENTS_HEATMAP_LAYER, EVENTS_HEATMAP_POINTS_LAYER],
};

/** Видимость оверлеев по store — без moveLayer и без побочных эффектов. */
function syncGeoOverlayLayers(
  map: MapLibreMap,
  layers: Record<GeoMapLayerId, boolean>,
): void {
  for (const [key, layerIds] of Object.entries(GEO_OVERLAY_LAYERS)) {
    const visible = layers[key as Exclude<GeoMapLayerId, "timeline">];
    for (const layerId of layerIds) {
      if (!map.getLayer(layerId)) continue;
      map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
    }
  }
}

/** promoteId — быстрый feature-state для выделения без полного setData. */
const REGION_GEOJSON_SOURCE = {
  type: "geojson" as const,
  promoteId: "regionCode",
};

const FEATURE_SELECTED: ["boolean", ["feature-state", "selected"], false] = [
  "boolean",
  ["feature-state", "selected"],
  false,
];

/** Дочерние сущности (place-маркер или полигон района) перекрывают регион. */
function hasChildEntityAtPointer(
  map: MapLibreMap,
  point: { x: number; y: number },
): boolean {
  return map.queryRenderedFeatures([point.x, point.y], {
    layers: [PLACES_LAYER, DISTRICTS_FILL, DISTRICTS_OUTLINE],
  }).length > 0;
}

/** Текст тултипа региона: уровень, время статуса, тип и фрагмент raw. */
function buildRegionPopupLines(code: string): string[] {
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
  ].filter((line): line is string => !!line);
}

/** Текст тултипа place: уровень, код статуса, время и фрагмент raw (как у региона). */
function buildPlacePopupLines(
  placeId: string,
  sourceMessage?: SourceMessage | null,
): string[] {
  const place = placesById$.value.get(placeId);
  if (!place) return [];

  const region = regionsByCode$.value.get(place.regionCode);
  const regionLevel = region?.stateLevel ?? "grey";
  const level = effectivePlaceLevel(place.stateLevel, regionLevel);

  return [
    `${place.placeName} · ${place.regionCode}`,
    LEVEL_LABELS[level],
    place.statusCode ? `тип: ${place.statusCode}` : null,
    place.statusEventAt ? `статус с ${formatDateTime(place.statusEventAt)}` : null,
    sourceMessage?.rawText ? sourceMessage.rawText.slice(0, 80) : null,
  ].filter((line): line is string => !!line);
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
 * Заливка приглушена; контур ≥ fill × GEO_MAP_STROKE_FILL_RATIO.
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
    features.push({
      ...feature,
      properties: {
        ...feature.properties,
        regionCode: code,
        stateLevel,
        color: LEVEL_COLORS[stateLevel],
        kind: "region",
        fillOpacity: geoMapFillOpacity(
          region.statusEventAt,
          now,
          GEO_MAP_REGION_FILL_OPACITY,
        ),
        lineOpacity: geoMapStrokeOpacity(
          region.statusEventAt,
          now,
          GEO_MAP_REGION_FILL_OPACITY,
          GEO_MAP_STROKE_FILL_RATIO,
        ),
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

/** Inset-контур для line-слоя (строго внутри полигона). */
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

/** Fill + inset-outline одним коммитом (общий fingerprint). */
function commitRegionSources(
  map: MapLibreMap,
  painted: GeoJsonCollection,
  fingerprints: Map<string, string>,
  force: boolean,
): boolean {
  const outlineData = paintRegionInsetOutlines(painted);
  const fingerprint = geoJsonFingerprint(painted);
  if (
    !force &&
    fingerprints.get(REGIONS_SOURCE) === fingerprint &&
    fingerprints.get(REGIONS_OUTLINE_SOURCE) === fingerprint
  ) {
    return true;
  }

  const fillSource = map.getSource(REGIONS_SOURCE) as GeoJSONSource | undefined;
  const outlineSource = map.getSource(REGIONS_OUTLINE_SOURCE) as GeoJSONSource | undefined;
  if (!fillSource || !outlineSource) return false;

  fillSource.setData(painted as never);
  outlineSource.setData(outlineData as never);
  fingerprints.set(REGIONS_SOURCE, fingerprint);
  fingerprints.set(REGIONS_OUTLINE_SOURCE, fingerprint);
  map.triggerRepaint();
  return true;
}

function pushRegionSources(
  map: MapLibreMap,
  painted: GeoJsonCollection,
  fingerprints: Map<string, string>,
  force: boolean,
  onCommitted: () => void,
): void {
  const push = (): boolean => commitRegionSources(map, painted, fingerprints, force);
  whenStyleReady(map, () => {
    if (push()) {
      onCommitted();
      return;
    }
    map.once("idle", () => {
      if (push()) onCommitted();
    });
  });
}

const DISTRICT_KINDS = new Set(["district", "city_district"]);

const PLACE_SOURCE_CACHE_MAX = 80;

/** LRU-кэш popup raw-сообщений — без неограниченного роста при hover. */
class LruCache<K, V> {
  private readonly maxSize: number;
  private readonly map = new Map<K, V>();

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }
}

/** Компактный отпечаток GeoJSON — пропускаем setData при неизменных данных. */
function geoJsonFingerprint(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const collection = data as { features?: Array<{ properties?: Record<string, unknown> }> };
  const features = collection.features ?? [];
  const parts = features.map((feature) => {
    const props = feature.properties ?? {};
    return [
      props.regionCode,
      props.placeId,
      props.stateLevel,
      props.statusEventAt,
      props.fillOpacity,
      props.lineOpacity,
      props.circleOpacity,
      props.circleStrokeOpacity,
      props.color,
    ].join(":");
  });
  return `${features.length}|${parts.join(";")}`;
}

/** Точки places: маркер-кружок; яркость затухает по statusEventAt (как у региона). */
function placesToFeatures(
  places: Map<string, MapPlaceSnapshot>,
  regions: Map<string, MapRegionSnapshot>,
  now: number,
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
          statusEventAt: place.statusEventAt ?? "",
          stateLabel: LEVEL_LABELS[level],
          color: LEVEL_COLORS[level],
          circleOpacity: geoMapFillOpacity(
            place.statusEventAt,
            now,
            GEO_MAP_PLACE_FILL_OPACITY,
          ),
          circleStrokeOpacity: geoMapStrokeOpacity(
            place.statusEventAt,
            now,
            GEO_MAP_PLACE_FILL_OPACITY,
            GEO_MAP_STROKE_FILL_RATIO,
          ),
          // Для district дублируется полигоном — маленький кружок-якорь.
          radius: DISTRICT_KINDS.has(place.kind ?? "") ? PLACE_CIRCLE_RADIUS_DISTRICT : PLACE_CIRCLE_RADIUS_DEFAULT,
        },
      };
    });
}

/**
 * Активные place-полигоны: из geo_feature оставляем только места со статусом.
 * Цвет — place.stateLevel; яркость затухает по place.statusEventAt.
 */
function paintActiveDistricts(
  base: GeoJsonCollection,
  places: Map<string, MapPlaceSnapshot>,
  regions: Map<string, MapRegionSnapshot>,
  now: number,
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
        kind: "place",
        color: LEVEL_COLORS[level],
        placeId: place.placeId,
        placeName: place.placeName,
        regionCode: place.regionCode,
        statusCode: place.statusCode,
        statusEventAt: place.statusEventAt ?? "",
        stateLabel: LEVEL_LABELS[level],
        fillOpacity: geoMapFillOpacity(
          place.statusEventAt,
          now,
          GEO_MAP_PLACE_FILL_OPACITY,
        ),
        lineOpacity: geoMapStrokeOpacity(
          place.statusEventAt,
          now,
          GEO_MAP_PLACE_FILL_OPACITY,
          GEO_MAP_STROKE_FILL_RATIO,
        ),
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
  // styledata вместо load: после setStyle load не всегда срабатывает; off — без утечки слушателей.
  const onStyleData = (): void => {
    if (!map.isStyleLoaded()) return;
    map.off("styledata", onStyleData);
    fn();
  };
  map.on("styledata", onStyleData);
}

/** setData с повтором на idle — после pan/zoom до загрузки geo источник может быть ещё не готов. */
function setGeoJsonSourceData(
  map: MapLibreMap,
  sourceId: string,
  data: unknown,
  lastFingerprints: Map<string, string>,
): boolean {
  const fingerprint = geoJsonFingerprint(data);
  if (lastFingerprints.get(sourceId) === fingerprint) {
    return true;
  }
  const source = map.getSource(sourceId) as GeoJSONSource | undefined;
  if (!source) return false;
  source.setData(data as never);
  lastFingerprints.set(sourceId, fingerprint);
  map.triggerRepaint();
  return true;
}

function applyGeoJsonSourceData(
  map: MapLibreMap,
  sourceId: string,
  data: unknown,
  lastFingerprints: Map<string, string>,
): void {
  const push = (): boolean => setGeoJsonSourceData(map, sourceId, data, lastFingerprints);
  whenStyleReady(map, () => {
    if (push()) return;
    map.once("idle", () => {
      push();
    });
  });
}

/**
 * Ждёт полной загрузки нового стиля после map.setStyle().
 * Используем постоянный listener на "styledata" — вызывает fn() после isStyleLoaded().
 */
function afterStyleChange(map: MapLibreMap, fn: () => void): void {
  const onStyleData = (): void => {
    if (!map.isStyleLoaded()) return;
    map.off("styledata", onStyleData);
    fn();
  };
  map.on("styledata", onStyleData);
}

const USER_SOURCE_IDS = [
  EVENTS_HEATMAP_SOURCE,
  "regions",
  "regions-outline-inset",
  "districts-active",
  "places",
] as const;

const USER_LAYER_IDS = new Set([
  EVENTS_HEATMAP_LAYER,
  EVENTS_HEATMAP_POINTS_LAYER,
  "regions-fill",
  "regions-outline",
  "regions-selection",
  "districts-active-fill",
  "districts-active-outline",
  "places-circles",
]);

/**
 * Используется как `transformStyle` при map.setStyle() для смены темы.
 * Сохраняет наши GeoJSON-источники и слои поверх новой подложки —
 * данные регионов и мест остаются на карте, меняются только тайлы.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function preserveUserLayers(prevStyle: any, nextStyle: any): any {
  const savedSources: Record<string, unknown> = {};
  for (const id of USER_SOURCE_IDS) {
    if (prevStyle?.sources?.[id]) savedSources[id] = prevStyle.sources[id];
  }
  const savedLayers = ((prevStyle?.layers ?? []) as Array<{ id: string }>).filter(
    (l) => USER_LAYER_IDS.has(l.id),
  );
  return {
    ...nextStyle,
    sources: { ...nextStyle.sources, ...savedSources },
    // Пользовательские слои — поверх базового стиля (в конец массива).
    layers: [...nextStyle.layers, ...savedLayers],
  };
}

function placesCollection(
  places: Map<string, MapPlaceSnapshot>,
  regions: Map<string, MapRegionSnapshot>,
  now = Date.now(),
) {
  return {
    type: "FeatureCollection" as const,
    features: placesToFeatures(places, regions, now),
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
  const now = Date.now();
  const placeFeatures = placesToFeatures(
    placesById$.value,
    regionsByCode$.value,
    now,
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
    let unsubTheme: Subscription | undefined;
    let unsubHeatmapPeriod: Subscription | undefined;
    let unsubHistoricalAsOf: Subscription | undefined;
    let unsubGeoMapLayers: Subscription | undefined;
    let heatmapReloadTimer: ReturnType<typeof setTimeout> | undefined;
    /**
     * Инициализируем null, чтобы первый emit BehaviorSubject всегда обрабатывался
     * (иначе code === prev → early return → flyToRegion не вызывается).
     */
    let highlightedCode: string | null = null;
    /** Сброс фильтра до загрузки контуров — догоняем fit после regions-geojson. */
    let requestOverviewFit = !selectedRegion$.value;
    let geoReloadTimer: ReturnType<typeof setTimeout> | undefined;
    let placesLayerTimer: ReturnType<typeof setTimeout> | undefined;
    let districtsReloadTimer: ReturnType<typeof setTimeout> | undefined;
    let districtsFetchGen = 0;
    let fadeTicker: ReturnType<typeof setInterval> | undefined;
    let placePopup: Popup | null = null;
    let regionPopup: Popup | null = null;
    /** Кэш raw-сообщения place — не дергаем API на каждый mousemove. */
    const placeSourceCache = new LruCache<string, SourceMessage | null>(PLACE_SOURCE_CACHE_MAX);
    const placeSourcePending = new Map<string, Promise<SourceMessage | null>>();
    /** Последний fingerprint GeoJSON per source — меньше native churn от setData. */
    const geoSourceFingerprints = new Map<string, string>();
    /** Fingerprint заливок регионов (включая fade bucket) — пропуск лишних repaint. */
    let lastRegionsPaintFingerprint = "";
    let activePlacePopupId: string | null = null;
    /** Пользователь сдвинул карту до прихода geojson — не делаем auto-fit/stop. */
    let userAdjustedViewBeforeGeo = false;
    let geoRecoveryHooked = false;
    // Хранит ссылку на maplibre после динамического import — нужна для Popup в обработчиках
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let maplibreRef: any = null;

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

    const buildRegionsPaintFingerprint = (now: number): string => {
      const fadeBucket = Math.floor(now / 60_000);
      const parts: string[] = [];
      for (const [code, region] of regionsByCode$.value) {
        if (!isRegionVisibleOnMap(region)) continue;
        parts.push(`${code}:${region.stateLevel}:${region.statusEventAt ?? ""}:${fadeBucket}`);
      }
      parts.sort();
      return parts.join("|");
    };

    const applyRegions = (force = false): void => {
      if (!map || !baseRegionsRef.current) return;
      whenStyleReady(map, () => {
        if (!map || !baseRegionsRef.current) return;
        const now = Date.now();
        const paintFingerprint = buildRegionsPaintFingerprint(now);
        if (!force && paintFingerprint === lastRegionsPaintFingerprint) {
          return;
        }
        lastRegionsPaintFingerprint = paintFingerprint;
        if (force) {
          geoSourceFingerprints.delete(REGIONS_SOURCE);
          geoSourceFingerprints.delete(REGIONS_OUTLINE_SOURCE);
        }
        const painted = paintRegionOutlines(
          baseRegionsRef.current,
          regionsByCode$.value,
          now,
        );
        setRegionOutlines(painted.features.length);
        pushRegionSources(map, painted, geoSourceFingerprints, force, () => {
          if (highlightedCode) setRegionFeatureSelected(map, highlightedCode, true);
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
     * Загружает активные районы с сервера и сразу рендерит.
     * Вызывается при каждом обновлении places — ответ маленький (единицы объектов).
     * Цвет берётся из place.stateLevel через `paintActiveDistricts`.
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
        applyGeoJsonSourceData(map, DISTRICTS_SOURCE, painted, geoSourceFingerprints);
      });
    };

    /** HTTP districts-active — только по debounce; отменяем устаревшие ответы. */
    const loadAndApplyDistricts = (): void => {
      if (!map) return;
      const fetchGen = ++districtsFetchGen;
      void mapApi.activeDistrictsGeoJson().then((layer) => {
        if (disposed || !map || fetchGen !== districtsFetchGen) return;
        baseDistrictsRef.current = layer as GeoJsonCollection;
        applyDistrictsLayer(baseDistrictsRef.current);
      }).catch((err: unknown) => {
        if (disposed || fetchGen !== districtsFetchGen) return;
        console.error("[GeoMapWidget] districts-active-geojson", err);
      });
    };

    const scheduleDistrictsReload = (): void => {
      clearTimeout(districtsReloadTimer);
      districtsReloadTimer = setTimeout(loadAndApplyDistricts, 500);
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
        setPlaceCount(collection.features.length);
        lastPlaceFeaturesRef.current = collection.features.length;
        applyGeoJsonSourceData(map, PLACES_SOURCE, collection, geoSourceFingerprints);
        if (baseDistrictsRef.current) {
          const painted = paintActiveDistricts(
            baseDistrictsRef.current,
            placesById$.value,
            regionsByCode$.value,
            now,
          );
          applyGeoJsonSourceData(map, DISTRICTS_SOURCE, painted, geoSourceFingerprints);
        }
      });
    };

    const schedulePlacesLayerRefresh = (): void => {
      clearTimeout(placesLayerTimer);
      placesLayerTimer = setTimeout(() => {
        applyPlacesFadeLayers();
        scheduleDistrictsReload();
      }, 120);
    };

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
          setRegionFeatureSelected(map, highlightedCode, true);
        }
        if (!userAdjustedViewBeforeGeo) {
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
          scheduleGeoLayerRecovery();
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
          return;
        }
        loadRegionGeometry();
      }, 300);
    };

    /** Загрузка теплокарты — только когда слой включён. */
    const loadEventsHeatmap = (): void => {
      if (!map || !geoMapLayers$.value.heatmap) return;
      clearTimeout(heatmapReloadTimer);
      heatmapReloadTimer = setTimeout(() => {
        if (disposed || !map || !geoMapLayers$.value.heatmap) return;
        const period = heatmapPeriod$.value;
        const until = historicalAsOf$.value ?? new Date().toISOString();
        setHeatmapLoading(true);
        void mapApi
          .eventsHeatmap({ period, until })
          .then((data) => {
            if (disposed || !map || !geoMapLayers$.value.heatmap) return;
            setHeatmapMeta(data.meta);
            applyGeoJsonSourceData(
              map,
              EVENTS_HEATMAP_SOURCE,
              { type: "FeatureCollection", features: data.features },
              geoSourceFingerprints,
            );
            syncGeoOverlayLayers(map, geoMapLayers$.value);
          })
          .catch((error: unknown) => {
            console.error("[GeoMapWidget] events-heatmap", error);
          })
          .finally(() => {
            if (!disposed) setHeatmapLoading(false);
          });
      }, 400);
    };

    const hideEventsHeatmap = (): void => {
      clearTimeout(heatmapReloadTimer);
      for (const layerId of [EVENTS_HEATMAP_LAYER, EVENTS_HEATMAP_POINTS_LAYER]) {
        if (map?.getLayer(layerId)) {
          map.setLayoutProperty(layerId, "visibility", "none");
        }
      }
      setHeatmapMeta(null);
      setHeatmapLoading(false);
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
            "fill-color": regionStateLevelColorExpression(),
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
            "line-color": regionStateLevelColorExpression(),
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
      const onPick = (event: MapLayerMouseEvent): void => {
        const props = event.features?.[0]?.properties;
        const code = props?.regionCode;
        if (typeof code === "string") {
          selectRegion(code === highlightedCode ? null : code);
        }
      };

      const resolvePlaceSource = async (placeId: string): Promise<SourceMessage | null> => {
        if (placeSourceCache.has(placeId)) {
          return placeSourceCache.get(placeId) ?? null;
        }
        let pending = placeSourcePending.get(placeId);
        if (!pending) {
          pending = mapApi
            .placeSourceMessage(placeId)
            .then((response) => response.message)
            .catch(() => null);
          placeSourcePending.set(placeId, pending);
        }
        const message = await pending;
        placeSourceCache.set(placeId, message);
        placeSourcePending.delete(placeId);
        return message;
      };

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

        void resolvePlaceSource(placeId).then((sourceMessage) => {
          if (!map || !placePopup || activePlacePopupId !== placeId) return;
          const enriched = buildPlacePopupLines(placeId, sourceMessage);
          if (enriched.length === 0) return;
          placePopup.setText(enriched.join("\n"));
        });
      };

      const onPlaceHover = (event: MapLayerMouseEvent): void => {
        const placeId = event.features?.[0]?.properties?.placeId;
        if (typeof placeId !== "string" || !placeId) return;
        showPlacePopup(event.lngLat, placeId);
      };

      const onDistrictHover = (event: MapLayerMouseEvent): void => {
        const placeId = event.features?.[0]?.properties?.placeId;
        if (typeof placeId !== "string" || !placeId) return;
        showPlacePopup(event.lngLat, placeId);
      };

      const onPlaceHoverEnd = (): void => {
        if (!map) return;
        map.getCanvas().style.cursor = "";
        activePlacePopupId = null;
        placePopup?.remove();
        placePopup = null;
      };

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

      map.on("load", () => {
        if (!map) return;

        setupLayersAndHandlers();

        loadRegionGeometry();
        loadAndApplyDistricts();
        applyPlaces();
        syncGeoOverlayLayers(map, geoMapLayers$.value);
        if (geoMapLayers$.value.heatmap) {
          loadEventsHeatmap();
        }

        unsubGeoMapLayers = geoMapLayers$.subscribe((layers) => {
          if (!map) return;
          syncGeoOverlayLayers(map, layers);
          if (layers.heatmap) loadEventsHeatmap();
          else hideEventsHeatmap();
        });
        unsubHeatmapPeriod = heatmapPeriod$.subscribe(() => {
          if (geoMapLayers$.value.heatmap) loadEventsHeatmap();
        });
        unsubHistoricalAsOf = historicalAsOf$.subscribe(() => {
          if (geoMapLayers$.value.heatmap) loadEventsHeatmap();
        });

        unsubRegions = regionsByCode$.subscribe(() => scheduleMapRefresh());
        unsubPlaces = placesById$.subscribe(() => schedulePlacesLayerRefresh());

        // appliedTheme хранит тему, уже применённую к карте —
        // реагируем только на реальное изменение, не на начальный emit BehaviorSubject.
        let appliedTheme = theme$.value;
        unsubTheme = theme$.subscribe((theme) => {
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
            if (highlightedCode) setRegionFeatureSelected(map, highlightedCode, true);
            applyRegions();
            if (baseDistrictsRef.current) {
              applyDistrictsLayer(baseDistrictsRef.current);
            }
            applyPlacesFadeLayers();
            applyEventsHeatmapPaint(map, theme);
            syncGeoOverlayLayers(map, geoMapLayers$.value);
            if (geoMapLayers$.value.heatmap) loadEventsHeatmap();
          });
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

        // Тик 60с: пересчёт fade для регионов, place-полигонов и маркеров.
        fadeTicker = setInterval(() => {
          if (disposed) return;
          applyRegions(false);
          applyPlacesFadeLayers();
        }, 60_000);
      });
    })();

    return () => {
      disposed = true;
      districtsFetchGen += 1;
      clearTimeout(geoReloadTimer);
      clearTimeout(placesLayerTimer);
      clearTimeout(districtsReloadTimer);
      clearTimeout(heatmapReloadTimer);
      clearInterval(fadeTicker);
      placePopup?.remove();
      placePopup = null;
      regionPopup?.remove();
      regionPopup = null;
      placeSourceCache.clear();
      placeSourcePending.clear();
      geoSourceFingerprints.clear();
      unsubRegions?.unsubscribe();
      unsubPlaces?.unsubscribe();
      unsubSelected?.unsubscribe();
      unsubTheme?.unsubscribe();
      unsubHeatmapPeriod?.unsubscribe();
      unsubHistoricalAsOf?.unsubscribe();
      unsubGeoMapLayers?.unsubscribe();
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
