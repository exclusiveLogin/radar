import type { RegionEntity } from "../geo/entities";

function toNumber(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

type CentroidInput = {
  centroidLat?: string | null | number;
  centroidLon?: string | null | number;
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

/** Centroid place после geo-enrich (nominatim/dadata) — операционная точка маркера. */
export function resolvePlaceEnrichedCentroid(input: {
  place: CentroidInput;
}): { lat: number; lon: number } | undefined {
  const lat = toNumber(input.place.centroidLat as string | null);
  const lon = toNumber(input.place.centroidLon as string | null);
  if (lat === undefined || lon === undefined) return undefined;
  return { lat, lon };
}

/** Centroid полигона каталога (geo_feature) — не подменяет enrich, только fallback маркера. */
export function resolveCatalogGeoFeatureCentroid(
  geoFeatureCentroid?: { lat: number; lon: number },
): { lat: number; lon: number } | undefined {
  return geoFeatureCentroid;
}

/**
 * Координаты маркера на карте: enrich-точка и полигон каталога — разные слои.
 * Маркер: enrich → fallback centroid полигона (пока enrich нет).
 * Полигон всегда по geoFeatureId на фронте, enrich его не отменяет.
 */
export function resolvePlaceMapMarkerCoords(input: {
  place: CentroidInput;
  geoFeatureCentroid?: { lat: number; lon: number };
}): { lat: number; lon: number } | undefined {
  return resolvePlaceEnrichedCentroid(input) ?? resolveCatalogGeoFeatureCentroid(input.geoFeatureCentroid);
}

/** @deprecated Используй resolvePlaceMapMarkerCoords — имя сохранено для heatmap/SQL-комментариев. */
export function resolvePlaceMapCentroid(input: {
  place: CentroidInput;
  geoFeatureCentroid?: { lat: number; lon: number };
}): { lat: number; lon: number } | undefined {
  return resolvePlaceMapMarkerCoords(input);
}
