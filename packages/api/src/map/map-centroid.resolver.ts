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
 * WGS84-координаты маркера place: place → region → средний центроид мест региона.
 * Без coords place на гео-карте не рисуется (layout ≠ реальная география).
 */
export function resolvePlaceMapCentroid(input: {
  place: CentroidInput;
  region: RegionEntity;
  placeFallback?: { lat: number; lon: number };
}): { lat: number; lon: number } | undefined {
  const fromPlace = {
    lat: toNumber(input.place.centroidLat),
    lon: toNumber(input.place.centroidLon),
  };
  if (fromPlace.lat !== undefined && fromPlace.lon !== undefined) {
    return { lat: fromPlace.lat, lon: fromPlace.lon };
  }

  const fromRegion = {
    lat: toNumber(input.region.centroidLat),
    lon: toNumber(input.region.centroidLon),
  };
  if (fromRegion.lat !== undefined && fromRegion.lon !== undefined) {
    return { lat: fromRegion.lat, lon: fromRegion.lon };
  }

  return input.placeFallback;
}
