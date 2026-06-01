import type { LayoutTile } from "../schemas/geo/region-state";

/** Приближённый bbox европейской части РФ для раскладки layout → WGS84. */
/** Согласовано с scripts/geo/generate-layout-rf.mjs (полная РФ). */
const LAYOUT_BBOX = {
  minLon: 19,
  maxLon: 169,
  minLat: 41,
  maxLat: 76,
} as const;

/**
 * Центроид региона по тайлу схемы (layout.json).
 * Только SchematicMapWidget — не использовать для MapLibre / WGS84-маркеров.
 * col → восток, row → юг.
 */
export function layoutTileToCentroid(
  tile: LayoutTile,
  cols: number,
  rows: number,
): { lat: number; lon: number } {
  const colSpan = Math.max(cols - 1, 1);
  const rowSpan = Math.max(rows - 1, 1);
  const lon =
    LAYOUT_BBOX.minLon
    + (tile.col / colSpan) * (LAYOUT_BBOX.maxLon - LAYOUT_BBOX.minLon);
  const lat =
    LAYOUT_BBOX.maxLat
    - (tile.row / rowSpan) * (LAYOUT_BBOX.maxLat - LAYOUT_BBOX.minLat);
  return { lat, lon };
}
