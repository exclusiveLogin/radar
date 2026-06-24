import { BehaviorSubject } from "rxjs";
import { setHeatmapMeta } from "./heatmapStore";
import { resetGeoMapLayerFetchStatus } from "./geoMapLayerFetchStore";

/** Оверлейные слои гео-карты (видимость + вложенные панели). */
export const GEO_MAP_LAYER_ORDER = [
  "regions",
  "threatIcons",
  "districts",
  "places",
  "heatmap",
  "timeline",
] as const;

export type GeoMapLayerId = (typeof GEO_MAP_LAYER_ORDER)[number];

/** Canvas-слои (без UI timeline) — участвуют в initial fit и forkJoin ready. */
export type GeoMapCanvasLayerId = Exclude<GeoMapLayerId, "timeline">;

export const GEO_MAP_CANVAS_LAYER_ORDER = GEO_MAP_LAYER_ORDER.filter(
  (id): id is GeoMapCanvasLayerId => id !== "timeline",
);

/** Включённые canvas-слои по текущим настройкам (LS → geoMapLayers$). */
export function enabledGeoMapCanvasLayers(
  layers: Record<GeoMapLayerId, boolean>,
): GeoMapCanvasLayerId[] {
  return GEO_MAP_CANVAS_LAYER_ORDER.filter((id) => layers[id]);
}

export const GEO_MAP_LAYER_LABELS: Record<GeoMapLayerId, string> = {
  regions: "Регионы",
  threatIcons: "Иконки угроз",
  districts: "Районы",
  places: "Места",
  heatmap: "Теплокарта",
  timeline: "Таймлайн",
};

const DEFAULT_GEO_MAP_LAYERS: Record<GeoMapLayerId, boolean> = {
  regions: true,
  threatIcons: true,
  districts: true,
  places: true,
  heatmap: false,
  timeline: true,
};

/** SSOT видимости слоёв карты. */
export const geoMapLayers$ = new BehaviorSubject<Record<GeoMapLayerId, boolean>>(
  DEFAULT_GEO_MAP_LAYERS,
);

export function isGeoMapLayerEnabled(id: GeoMapLayerId): boolean {
  return geoMapLayers$.value[id];
}

export function setGeoMapLayer(id: GeoMapLayerId, enabled: boolean): void {
  geoMapLayers$.next({ ...geoMapLayers$.value, [id]: enabled });
  if (id === "heatmap" && !enabled) {
    setHeatmapMeta(null);
    resetGeoMapLayerFetchStatus("heatmap");
  }
}

export function toggleGeoMapLayer(id: GeoMapLayerId): void {
  setGeoMapLayer(id, !geoMapLayers$.value[id]);
}
