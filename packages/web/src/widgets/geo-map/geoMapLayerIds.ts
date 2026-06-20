import {
  EVENTS_HEATMAP_LAYER,
  EVENTS_HEATMAP_POINTS_LAYER,
  EVENTS_HEATMAP_SOURCE,
} from "../../shared/config/mapConfig.service";
import type { GeoMapLayerId } from "../../shared/state/mapLayerStore";

/** Идентификаторы GeoJSON-источников MapLibre. */
export const REGIONS_SOURCE = "regions";
export const REGIONS_OUTLINE_SOURCE = "regions-outline-inset";
export const DISTRICTS_SOURCE = "districts-active";
export const PLACES_SOURCE = "places";
export const VICINITY_SCOPES_SOURCE = "vicinity-scopes";

/** Идентификаторы слоёв оверлея. */
export const REGIONS_FILL = "regions-fill";
export const REGIONS_OUTLINE = "regions-outline";
export const REGIONS_SELECTION = "regions-selection";
export const DISTRICTS_FILL = "districts-active-fill";
export const DISTRICTS_OUTLINE = "districts-active-outline";
export const PLACES_LAYER = "places-circles";
export const VICINITY_SCOPES_FILL = "vicinity-scopes-fill";
export const VICINITY_SCOPES_OUTLINE = "vicinity-scopes-outline";

/** Z-order (снизу вверх): region → district → heatmap → vicinity → place. */
export const GEO_ENTITY_LAYER_ORDER = [
  REGIONS_FILL,
  REGIONS_OUTLINE,
  REGIONS_SELECTION,
  DISTRICTS_FILL,
  DISTRICTS_OUTLINE,
  EVENTS_HEATMAP_LAYER,
  EVENTS_HEATMAP_POINTS_LAYER,
  VICINITY_SCOPES_FILL,
  VICINITY_SCOPES_OUTLINE,
  PLACES_LAYER,
] as const;

/** SSOT: toggle mapLayerStore → id слоёв MapLibre. */
export const GEO_OVERLAY_LAYERS: Record<
  Exclude<GeoMapLayerId, "timeline">,
  readonly string[]
> = {
  regions: [REGIONS_FILL, REGIONS_OUTLINE, REGIONS_SELECTION],
  districts: [DISTRICTS_FILL, DISTRICTS_OUTLINE],
  places: [PLACES_LAYER],
  heatmap: [EVENTS_HEATMAP_LAYER, EVENTS_HEATMAP_POINTS_LAYER],
};

/** promoteId — MapLibre использует regionCode как id для setFeatureState. */
export const REGION_GEOJSON_SOURCE = {
  type: "geojson" as const,
  promoteId: "regionCode",
};

/** MapLibre expression: feature-state.selected. */
export const FEATURE_SELECTED: ["boolean", ["feature-state", "selected"], false] = [
  "boolean",
  ["feature-state", "selected"],
  false,
];

/** Наши GeoJSON-источники — переносятся при map.setStyle(transformStyle). */
export const USER_SOURCE_IDS = [
  EVENTS_HEATMAP_SOURCE,
  REGIONS_SOURCE,
  REGIONS_OUTLINE_SOURCE,
  DISTRICTS_SOURCE,
  PLACES_SOURCE,
  VICINITY_SCOPES_SOURCE,
] as const;

/** Наши слои оверлея — сохраняются поверх тайловой подложки. */
export const USER_LAYER_IDS = new Set([
  EVENTS_HEATMAP_LAYER,
  EVENTS_HEATMAP_POINTS_LAYER,
  REGIONS_FILL,
  REGIONS_OUTLINE,
  REGIONS_SELECTION,
  DISTRICTS_FILL,
  DISTRICTS_OUTLINE,
  VICINITY_SCOPES_FILL,
  VICINITY_SCOPES_OUTLINE,
  PLACES_LAYER,
]);
