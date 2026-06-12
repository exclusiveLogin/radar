import { BehaviorSubject } from "rxjs";
import { setHeatmapMeta } from "./heatmapStore";
import { resetGeoMapLayerFetchStatus } from "./geoMapLayerFetchStore";

/** Оверлейные слои гео-карты (видимость + вложенные панели). */
export const GEO_MAP_LAYER_ORDER = [
  "regions",
  "districts",
  "places",
  "heatmap",
  "timeline",
] as const;

export type GeoMapLayerId = (typeof GEO_MAP_LAYER_ORDER)[number];

export const GEO_MAP_LAYER_LABELS: Record<GeoMapLayerId, string> = {
  regions: "Регионы",
  districts: "Районы",
  places: "Места",
  heatmap: "Теплокарта",
  timeline: "Таймлайн",
};

const DEFAULT_GEO_MAP_LAYERS: Record<GeoMapLayerId, boolean> = {
  regions: true,
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
