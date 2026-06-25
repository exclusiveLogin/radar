import type { Map as MapLibreMap } from "maplibre-gl";
import { timer, type Subscription } from "rxjs";
import { take } from "rxjs/operators";
import type { MapRegionSnapshot, SourceMessage } from "@radar/shared";
import { resolveThreatVisual } from "@radar/shared";
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
import { derivedRegionCodes$, placesById$, regionsByCode$, resolveMapViewAnchorMs } from "../../shared/state/mapStore";
import type { GeoMapLayerId } from "../../shared/state/mapLayerStore";
import { stateChangesFeed$ } from "../../shared/state/stateChangesFeedStore";
import { statusTitle } from "../../shared/state/statusDictionaryStore";
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

/** Поднимает наши слои в фиксированном z-order (region/district внизу, places сверху). */
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

/** Подпись уровня региона; ×N — счётчик activity (fold пока не считает → скрываем при 0). */
function formatRegionLevelLine(
  region: MapRegionSnapshot | undefined,
  isDerived: boolean,
): string | null {
  if (!region) return null;
  const levelLabel = LEVEL_LABELS[region.stateLevel];
  if (isDerived) return `${levelLabel} (производный)`;
  if (region.activity > 0) return `${levelLabel} · ×${region.activity}`;
  return levelLabel;
}

/** Текст тултипа региона: уровень, время статуса, тип и фрагмент raw. */
export function buildRegionPopupLines(code: string): string[] {
  const region = regionsByCode$.value.get(code);
  const isDerived = derivedRegionCodes$.value.has(code);
  const recentEvent = stateChangesFeed$.value.find((e) => e.regionCodes.includes(code));
  const levelLine = formatRegionLevelLine(region, isDerived);
  return [
    `${code} — ${region?.name ?? code}`,
    levelLine,
    recentEvent?.eventType ? `тип: ${recentEvent.eventType}` : null,
    region?.statusEventAt ? `статус с ${formatDateTime(region.statusEventAt)}` : null,
    recentEvent?.displayText ?? recentEvent?.rawText
      ? (recentEvent.displayText ?? recentEvent.rawText).slice(0, 80)
      : null,
  ].filter((line): line is string => !!line);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function traitGlyphs(traits?: { mass?: boolean; uncertain?: boolean }): string {
  const parts: string[] = [];
  if (traits?.uncertain) parts.push('<span class="ds-event-trait ds-event-trait--uncertain" title="Неподтверждённый">?</span>');
  if (traits?.mass) parts.push('<span class="ds-event-trait ds-event-trait--mass" title="Массовость">⚡</span>');
  if (parts.length === 0) return "";
  return `<span class="ds-event-traits ds-event-traits--compact">${parts.join("")}</span>`;
}

/** HTML тултипа региона: иконка угрозы, уровень, traits, время. */
export function buildRegionPopupHtml(code: string): string {
  const region = regionsByCode$.value.get(code);
  const isDerived = derivedRegionCodes$.value.has(code);
  const recentEvent = stateChangesFeed$.value.find((e) => e.regionCodes.includes(code));
  const visual = region
    ? resolveThreatVisual({
        statusCode: region.statusCode,
        traits: region.traits,
        eventSubject: region.eventSubject,
      })
    : null;

  const titleLine = region
    ? `${escapeHtml(code)} — ${escapeHtml(region.name)}`
    : escapeHtml(code);

  const iconHtml = visual
    ? `<span class="ds-threat-icon ds-threat-icon--compact ds-threat-icon--${visual.key}${visual.dimmed ? " ds-threat-icon--dimmed" : ""}" style="color:${visual.accentColor}" aria-hidden="true">${visual.glyph}</span>`
    : "";

  const statusText = region?.statusCode
    ? `${statusTitle(region.statusCode)} (${region.statusCode})`
    : recentEvent?.eventType
      ? recentEvent.eventType
      : "";
  const statusLabel = statusText ? escapeHtml(statusText) : "";

  const levelLine = formatRegionLevelLine(region, isDerived);
  const levelHtml = levelLine ? escapeHtml(levelLine) : "";

  const traitsHtml = traitGlyphs(region?.traits);

  const timeLine = region?.statusEventAt
    ? escapeHtml(formatDateTime(region.statusEventAt))
    : "";

  const textSnippet = recentEvent?.displayText ?? recentEvent?.rawText
    ? escapeHtml((recentEvent.displayText ?? recentEvent.rawText).slice(0, 80))
    : "";
  const channel = recentEvent?.channelTitle ?? recentEvent?.channelKey ?? "—";
  const eventType = recentEvent?.eventType ?? "—";
  const area = region?.name ?? "—";
  const regionLabel = region?.name ?? code;

  return [
    `<div class="geo-map-region-popup__head">${iconHtml}<strong>${titleLine}</strong></div>`,
    `<div><strong>Область:</strong> ${escapeHtml(area)}</div>`,
    `<div><strong>Код:</strong> ${escapeHtml(code)}</div>`,
    `<div><strong>Регион:</strong> ${escapeHtml(regionLabel)}</div>`,
    statusLabel
      ? `<div class="geo-map-region-popup__type"><strong>Статус:</strong> ${statusLabel}${traitsHtml ? ` ${traitsHtml}` : ""}</div>`
      : `<div><strong>Статус:</strong> —${traitsHtml ? ` ${traitsHtml}` : ""}</div>`,
    `<div><strong>Тип последнего сообщения:</strong> ${escapeHtml(eventType)}</div>`,
    `<div><strong>Канал:</strong> ${escapeHtml(channel)}</div>`,
    timeLine ? `<div class="geo-map-region-popup__time ds-muted"><strong>Время статуса:</strong> ${timeLine}</div>` : `<div class="geo-map-region-popup__time ds-muted"><strong>Время статуса:</strong> —</div>`,
    textSnippet ? `<div class="geo-map-region-popup__text"><strong>Сообщение:</strong> ${textSnippet}</div>` : `<div class="geo-map-region-popup__text"><strong>Сообщение:</strong> —</div>`,
    levelHtml ? `<div class="geo-map-region-popup__level">${levelHtml}</div>` : "",
  ]
    .filter(Boolean)
    .join("");
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
  const recentEvent = stateChangesFeed$.value.find((e) => e.regionCodes.includes(place.regionCode));
  const statusText = place.statusCode
    ? `${statusTitle(place.statusCode)} (${place.statusCode})`
    : "—";
  const eventType = recentEvent?.eventType ?? "—";
  const channel = recentEvent?.channelTitle ?? recentEvent?.channelKey ?? sourceMessage?.channelKey ?? "—";
  const message = (sourceMessage?.displayText ?? sourceMessage?.rawText ?? recentEvent?.displayText ?? recentEvent?.rawText ?? "—").slice(0, 120);

  return [
    `Область: ${region?.name ?? "—"}`,
    `Код: ${place.regionCode}`,
    `Регион: ${place.placeName}`,
    `Статус: ${statusText}`,
    `Уровень: ${LEVEL_LABELS[level]}`,
    `Тип последнего сообщения: ${eventType}`,
    `Канал: ${channel}`,
    place.statusEventAt ? `Время статуса: ${formatDateTime(place.statusEventAt)}` : "Время статуса: —",
    `Сообщение: ${message}`,
  ].filter((line): line is string => !!line);
}

/**
 * Ждёт полной загрузки нового стиля после map.setStyle().
 * При недоступности CDN — fallback на inline minimal style (без внешних тайлов).
 */
export function afterStyleChange(
  map: MapLibreMap,
  fn: () => void,
  options?: { fallbackStyle?: unknown; timeoutMs?: number },
): void {
  let done = false;
  const timeoutMs = options?.timeoutMs ?? 5_000;
  let timeoutSub: Subscription | undefined;

  const run = (): void => {
    if (done) return;
    done = true;
    map.off("styledata", onStyleData);
    map.off("load", onStyleData);
    timeoutSub?.unsubscribe();
    fn();
  };

  const onStyleData = (): void => {
    if (!map.isStyleLoaded()) return;
    run();
  };

  map.on("styledata", onStyleData);
  map.on("load", onStyleData);
  if (map.isStyleLoaded()) run();

  timeoutSub = timer(timeoutMs).pipe(take(1)).subscribe(() => {
    if (done) return;
    if (map.isStyleLoaded()) {
      run();
      return;
    }
    if (options?.fallbackStyle) {
      map.setStyle(options.fallbackStyle as never, {
        transformStyle: preserveUserLayers,
      } as never);
      return;
    }
    run();
  });
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
  const now = resolveMapViewAnchorMs();
  const painted = paintRegionOutlines(base, regionsByCode$.value, now);
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
