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
export const REGIONS_THREAT_SOURCE = "regions-threat";
export const VICINITY_SCOPES_SOURCE = "vicinity-scopes";

/** Идентификаторы слоёв оверлея. */
export const REGIONS_FILL = "regions-fill";
export const REGIONS_OUTLINE = "regions-outline";
export const REGIONS_SELECTION = "regions-selection";
export const DISTRICTS_FILL = "districts-active-fill";
export const DISTRICTS_OUTLINE = "districts-active-outline";
export const PLACES_LAYER = "places-circles";
export const REGIONS_THREAT_LAYER = "regions-threat-glyphs";
export const REGIONS_THREAT_HALO = "regions-threat-halo";
export const VICINITY_SCOPES_FILL = "vicinity-scopes-fill";
export const VICINITY_SCOPES_OUTLINE = "vicinity-scopes-outline";

// ── Tracking layers ──────────────────────────────────────────────────────────

/** GeoJSON source: L1 треки (LineString + origin Point). */
export const TRACKS_SOURCE = "tracks";
/** GeoJSON source: L2 flow-коридоры (LineString с весом). */
export const TRACKS_FLOW_SOURCE = "tracks-flow";

/** Слой линий треков. */
export const TRACKS_LINES_LAYER = "tracks-lines";
/** Слой маркеров начала трека (origin). */
export const TRACKS_ORIGIN_LAYER = "tracks-origin";
/** Слой линий flow-коридоров (толщина ∝ weight). */
export const TRACKS_FLOW_LAYER = "tracks-flow-lines";

// ─────────────────────────────────────────────────────────────────────────────

/** Z-order (снизу вверх): region → district → heatmap → tracks → vicinity → place. */
export const GEO_ENTITY_LAYER_ORDER = [
  REGIONS_FILL,
  REGIONS_OUTLINE,
  REGIONS_SELECTION,
  DISTRICTS_FILL,
  DISTRICTS_OUTLINE,
  EVENTS_HEATMAP_LAYER,
  EVENTS_HEATMAP_POINTS_LAYER,
  TRACKS_FLOW_LAYER,
  TRACKS_LINES_LAYER,
  TRACKS_ORIGIN_LAYER,
  VICINITY_SCOPES_FILL,
  VICINITY_SCOPES_OUTLINE,
  REGIONS_THREAT_HALO,
  REGIONS_THREAT_LAYER,
  PLACES_LAYER,
] as const;

/** SSOT: toggle mapLayerStore → id слоёв MapLibre. */
export const GEO_OVERLAY_LAYERS: Record<
  Exclude<GeoMapLayerId, "timeline">,
  readonly string[]
> = {
  regions: [REGIONS_FILL, REGIONS_OUTLINE, REGIONS_SELECTION],
  threatIcons: [REGIONS_THREAT_HALO, REGIONS_THREAT_LAYER],
  districts: [DISTRICTS_FILL, DISTRICTS_OUTLINE],
  places: [PLACES_LAYER],
  vicinity: [VICINITY_SCOPES_FILL, VICINITY_SCOPES_OUTLINE],
  heatmap: [EVENTS_HEATMAP_LAYER, EVENTS_HEATMAP_POINTS_LAYER],
  tracks: [TRACKS_LINES_LAYER, TRACKS_ORIGIN_LAYER],
  tracksFlow: [TRACKS_FLOW_LAYER],
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
  REGIONS_THREAT_SOURCE,
  VICINITY_SCOPES_SOURCE,
  TRACKS_SOURCE,
  TRACKS_FLOW_SOURCE,
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
  REGIONS_THREAT_HALO,
  REGIONS_THREAT_LAYER,
  PLACES_LAYER,
  TRACKS_LINES_LAYER,
  TRACKS_ORIGIN_LAYER,
  TRACKS_FLOW_LAYER,
]);
