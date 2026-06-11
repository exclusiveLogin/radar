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
import { fadedLayerOpacity, regionFadeFactor } from "../../shared/utils/regionFade";
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
  resolveMapBasemapStyleForTheme,
} from "../../shared/config/mapConfig.service";
import { formatDateTime } from "../../shared/format/dateTime";
import { effectivePlaceLevel, isPlaceVisibleOnMap, isRegionVisibleOnMap } from "../../shared/state/derivations";
import { derivedRegionCodes$, placesById$, regionsByCode$ } from "../../shared/state/mapStore";
import { selectRegion, selectedRegion$ } from "../../shared/state/selectionStore";
import { stateChangesFeed$ } from "../../shared/state/stateChangesFeedStore";
import { theme$ } from "../../shared/state/themeStore";
import type { WidgetProps } from "../widgetProps";
import { insetRegionGeometry } from "./regionInsetOutline";

const REGIONS_SOURCE = "regions";
const REGIONS_OUTLINE_SOURCE = "regions-outline-inset";
const REGIONS_FILL = "regions-fill";
const REGIONS_OUTLINE = "regions-outline";
const REGIONS_SELECTION = "regions-selection";
/** Базовая непрозрачность контура place-полигона (до fade). */
const PLACE_MAP_STROKE_OPACITY = 0.85;

/** Слой активных place-полигонов (geo_feature) — рисуется над регионами. */
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

/** Дочерние сущности (place-маркер или полигон района) перекрывают регион. */
function hasChildEntityAtPointer(
  map: MapLibreMap,
  point: { x: number; y: number },
): boolean {
  return map.queryRenderedFeatures(point, {
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
          circleOpacity: fadedLayerOpacity(place.statusEventAt, now, 1),
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
        fillOpacity: fadedLayerOpacity(place.statusEventAt, now, DISTRICT_MAP_FILL_OPACITY),
        lineOpacity: fadedLayerOpacity(place.statusEventAt, now, PLACE_MAP_STROKE_OPACITY),
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
  "regions",
  "regions-outline-inset",
  "districts-active",
  "places",
] as const;

const USER_LAYER_IDS = new Set([
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
        const painted = paintRegionOutlines(
          baseRegionsRef.current,
          regionsByCode$.value,
          now,
        );
        setRegionOutlines(painted.features.length);
        applyGeoJsonSourceData(map, REGIONS_SOURCE, painted, geoSourceFingerprints);
        applyGeoJsonSourceData(
          map,
          REGIONS_OUTLINE_SOURCE,
          paintRegionInsetOutlines(painted),
          geoSourceFingerprints,
        );
        if (highlightedCode) {
          setRegionFeatureSelected(map, highlightedCode, true);
        }
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
      if (!baseRegionsRef.current) return;
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
            "fill-color": ["coalesce", ["get", "color"], LEVEL_COLORS.grey],
            "fill-opacity": [
              "case",
              FEATURE_SELECTED,
              REGION_MAP_SELECTED_FILL_OPACITY,
              ["coalesce", ["get", "fillOpacity"], REGION_MAP_FILL_OPACITY],
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
      }
      if (!map.getLayer(REGIONS_SELECTION)) {
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
            "fill-opacity": ["coalesce", ["get", "fillOpacity"], DISTRICT_MAP_FILL_OPACITY],
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
            "line-opacity": ["coalesce", ["get", "lineOpacity"], PLACE_MAP_STROKE_OPACITY],
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
            "circle-opacity": ["coalesce", ["get", "circleOpacity"], 1],
          },
        });
        map.moveLayer(PLACES_LAYER);
      }

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
