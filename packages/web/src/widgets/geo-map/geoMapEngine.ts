import type { Map as MapLibreMap } from "maplibre-gl";
import type { SourceMessage } from "@radar/shared";
import {
  EVENTS_HEATMAP_LAYER,
  EVENTS_HEATMAP_POINTS_LAYER,
  eventsHeatmapPaint,
  eventsHeatmapPointsPaint,
  LEVEL_LABELS,
  MAP_INITIAL_VIEW,
} from "../../shared/config/mapConfig.service";
import { formatDateTime } from "../../shared/format/dateTime";
import { effectivePlaceLevel } from "../../shared/state/derivations";
import { derivedRegionCodes$, placesById$, regionsByCode$ } from "../../shared/state/mapStore";
import type { GeoMapLayerId } from "../../shared/state/mapLayerStore";
import { stateChangesFeed$ } from "../../shared/state/stateChangesFeedStore";
import type { ThemeMode } from "../../shared/state/themeStore";
import {
  DISTRICTS_FILL,
  DISTRICTS_OUTLINE,
  GEO_ENTITY_LAYER_ORDER,
  GEO_OVERLAY_LAYERS,
  PLACES_LAYER,
  USER_LAYER_IDS,
  USER_SOURCE_IDS,
} from "./geoMapLayerIds";
import { paintRegionOutlines, placesToFeatures } from "./geoMapPaint";
import type { GeoJsonCollection, PointFeature, PolygonFeature } from "./geoMapTypes";

/** Поднимает наши слои в фиксированном z-order (heatmap внизу, places сверху). */
export function enforceGeoEntityLayerOrder(map: MapLibreMap): void {
  for (const layerId of GEO_ENTITY_LAYER_ORDER) {
    if (map.getLayer(layerId)) map.moveLayer(layerId);
  }
}

/** Применяет paint теплокарты (heatmap + points) под текущую тему. */
export function applyEventsHeatmapPaint(map: MapLibreMap, theme: ThemeMode): void {
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

/** Видимость оверлеев по store — без moveLayer и без побочных эффектов. */
export function syncGeoOverlayLayers(
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

/** Дочерние сущности (place-маркер или полигон района) перекрывают регион. */
export function hasChildEntityAtPointer(
  map: MapLibreMap,
  point: { x: number; y: number },
): boolean {
  return map.queryRenderedFeatures([point.x, point.y], {
    layers: [PLACES_LAYER, DISTRICTS_FILL, DISTRICTS_OUTLINE],
  }).length > 0;
}

/** Текст тултипа региона: уровень, время статуса, тип и фрагмент raw. */
export function buildRegionPopupLines(code: string): string[] {
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
export function buildPlacePopupLines(
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

/**
 * Ждёт полной загрузки нового стиля после map.setStyle().
 * Используем постоянный listener на "styledata" — вызывает fn() после isStyleLoaded().
 */
export function afterStyleChange(map: MapLibreMap, fn: () => void): void {
  const onStyleData = (): void => {
    if (!map.isStyleLoaded()) return;
    map.off("styledata", onStyleData);
    fn();
  };
  map.on("styledata", onStyleData);
}

/**
 * Используется как `transformStyle` при map.setStyle() для смены темы.
 * Сохраняет наши GeoJSON-источники и слои поверх новой подложки.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function preserveUserLayers(prevStyle: any, nextStyle: any): any {
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
    layers: [...nextStyle.layers, ...savedLayers],
  };
}

/** Подгоняет камеру под bbox всех переданных регионов и place-точек. */
export function fitMapView(
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
export function fitOperationalOverview(
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
export function flyToRegion(
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
