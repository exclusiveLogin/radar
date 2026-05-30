type LonLat = [number, number];

type GeoPolygon = {
  type: "Polygon";
  coordinates: LonLat[][];
};
type GeoMultiPolygon = {
  type: "MultiPolygon";
  coordinates: LonLat[][][];
};

type GeoGeometry = GeoPolygon | GeoMultiPolygon | { type: string; coordinates: unknown };

/** Центроид кольца (без учёга замыкающей точки). */
function ringCentroid(ring: LonLat[]): LonLat {
  const pts =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : ring;
  if (pts.length === 0) return [0, 0];
  let sx = 0;
  let sy = 0;
  for (const [x, y] of pts) {
    sx += x;
    sy += y;
  }
  return [sx / pts.length, sy / pts.length];
}

/** Сжимает кольцо к центроиду — контур остаётся строго внутри исходного полигона. */
function insetRing(ring: LonLat[], factor: number): LonLat[] {
  const [cx, cy] = ringCentroid(ring);
  return ring.map(([x, y]) => [cx + (x - cx) * factor, cy + (y - cy) * factor]);
}

/**
 * Inset-геометрия для line-слоя: ~0.4% к центру (на масштабе области достаточно для stroke).
 * Не зависит от winding order, в отличие от line-offset.
 */
export function insetRegionGeometry(
  geometry: GeoGeometry,
  factor = 0.996,
): GeoGeometry {
  if (geometry.type === "Polygon") {
    const poly = geometry as GeoPolygon;
    return {
      type: "Polygon",
      coordinates: poly.coordinates.map((ring, i) =>
        i === 0 ? insetRing(ring, factor) : ring,
      ),
    };
  }
  if (geometry.type === "MultiPolygon") {
    const multi = geometry as GeoMultiPolygon;
    return {
      type: "MultiPolygon",
      coordinates: multi.coordinates.map((poly) =>
        poly.map((ring, i) => (i === 0 ? insetRing(ring, factor) : ring)),
      ),
    };
  }
  return geometry;
}
