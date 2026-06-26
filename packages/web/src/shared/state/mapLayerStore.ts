import { BehaviorSubject } from "rxjs";
import { setHeatmapMeta } from "./heatmapStore";
import { resetGeoMapLayerFetchStatus } from "./geoMapLayerFetchStore";
import { readMapLayers, writeMapLayers } from "./uiPreferencesStore";

/** Оверлейные слои гео-карты (видимость + вложенные панели). */
export const GEO_MAP_LAYER_ORDER = [
  "regions",
  "threatIcons",
  "districts",
  "places",
  "vicinity",
  "heatmap",
  "tracks",
  "tracksFlow",
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
  vicinity: "Радиус «около»",
  heatmap: "Теплокарта",
  tracks: "Треки",
  tracksFlow: "Коридоры",
  timeline: "Таймлайн",
};

const DEFAULT_GEO_MAP_LAYERS: Record<GeoMapLayerId, boolean> = {
  regions: true,
  threatIcons: true,
  districts: true,
  places: true,
  vicinity: true,
  heatmap: false,
  tracks: false,
  tracksFlow: false,
  timeline: true,
};

function readPersistedGeoMapLayers(): Record<GeoMapLayerId, boolean> {
  const persisted = readMapLayers(DEFAULT_GEO_MAP_LAYERS);
  return {
    regions: persisted.regions ?? DEFAULT_GEO_MAP_LAYERS.regions,
    threatIcons: persisted.threatIcons ?? DEFAULT_GEO_MAP_LAYERS.threatIcons,
    districts: persisted.districts ?? DEFAULT_GEO_MAP_LAYERS.districts,
    places: persisted.places ?? DEFAULT_GEO_MAP_LAYERS.places,
    vicinity: persisted.vicinity ?? DEFAULT_GEO_MAP_LAYERS.vicinity,
    heatmap: persisted.heatmap ?? DEFAULT_GEO_MAP_LAYERS.heatmap,
    tracks: persisted.tracks ?? DEFAULT_GEO_MAP_LAYERS.tracks,
    tracksFlow: persisted.tracksFlow ?? DEFAULT_GEO_MAP_LAYERS.tracksFlow,
    timeline: persisted.timeline ?? DEFAULT_GEO_MAP_LAYERS.timeline,
  };
}

/** SSOT видимости слоёв карты. */
export const geoMapLayers$ = new BehaviorSubject<Record<GeoMapLayerId, boolean>>(
  readPersistedGeoMapLayers(),
);

export function isGeoMapLayerEnabled(id: GeoMapLayerId): boolean {
  return geoMapLayers$.value[id];
}

export function setGeoMapLayer(id: GeoMapLayerId, enabled: boolean): void {
  const next = { ...geoMapLayers$.value, [id]: enabled };
  geoMapLayers$.next(next);
  writeMapLayers(next);
  if (id === "heatmap" && !enabled) {
    setHeatmapMeta(null);
    resetGeoMapLayerFetchStatus("heatmap");
  }
  if ((id === "tracks" || id === "tracksFlow") && !enabled) {
    resetGeoMapLayerFetchStatus(id);
  }
}

export function toggleGeoMapLayer(id: GeoMapLayerId): void {
  setGeoMapLayer(id, !geoMapLayers$.value[id]);
}
