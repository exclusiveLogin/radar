import type { LayoutTile } from "../schemas/geo/region-state";

/** Приближённый bbox европейской части РФ для раскладки layout → WGS84. */
const LAYOUT_BBOX = {
  minLon: 27,
  maxLon: 145,
  minLat: 43,
  maxLat: 70,
} as const;

/**
 * Центроид региона по тайлу схемы (layout.json), если в БД нет координат.
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
