import type { RegionEntity } from "../geo/entities";

function toNumber(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

type CentroidInput = {
  centroidLat: string | null;
  centroidLon: string | null;
};

/**
 * WGS84-центроид региона для гео-карты: только БД или средний центроид мест.
 * Layout-тайлы — только для SchematicMapWidget, не подставлять сюда.
 */
export function resolveRegionCentroid(input: {
  region: RegionEntity;
  placeFallback?: { lat: number; lon: number };
}): { lat: number; lon: number } | undefined {
  const fromDb = {
    lat: toNumber(input.region.centroidLat),
    lon: toNumber(input.region.centroidLon),
  };
  if (fromDb.lat !== undefined && fromDb.lon !== undefined) {
    return { lat: fromDb.lat, lon: fromDb.lon };
  }
  return input.placeFallback;
}

/**
 * WGS84-координаты маркера place: ТОЛЬКО собственный центроид места.
 * Инвариант карты: region = контур, place = точка с реальной геопозицией.
 * Без своих coords место не рисуется точкой (его уровень отражает контур региона) —
 * иначе fallback на центр региона даёт фантомные точки (двойники регионов, мусорные топонимы).
 */
export function resolvePlaceMapCentroid(input: {
  place: CentroidInput;
}): { lat: number; lon: number } | undefined {
  const lat = toNumber(input.place.centroidLat);
  const lon = toNumber(input.place.centroidLon);
  if (lat === undefined || lon === undefined) return undefined;
  return { lat, lon };
}
