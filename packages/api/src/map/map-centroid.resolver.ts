import { layoutTileToCentroid } from "@radar/shared";
import type { LayoutTile, StateLevel } from "@radar/shared";
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

/** Центроид региона: БД → fallback places → layout (для активных без coords). */
export function resolveRegionCentroid(input: {
  region: RegionEntity;
  code: string;
  tile?: LayoutTile;
  layoutCols: number;
  layoutRows: number;
  placeFallback?: { lat: number; lon: number };
  stateLevel: StateLevel;
}): { lat: number; lon: number } | undefined {
  const fromDb = {
    lat: toNumber(input.region.centroidLat),
    lon: toNumber(input.region.centroidLon),
  };
  if (fromDb.lat !== undefined && fromDb.lon !== undefined) {
    return { lat: fromDb.lat, lon: fromDb.lon };
  }
  if (input.placeFallback) return input.placeFallback;
  if (input.stateLevel !== "grey" && input.tile) {
    return layoutTileToCentroid(input.tile, input.layoutCols, input.layoutRows);
  }
  return undefined;
}

/**
 * Координаты маркера place на гео-карте: place → region → layout.
 * Активный place без coords всё равно рисуется (fallback layout региона).
 */
export function resolvePlaceMapCentroid(input: {
  place: CentroidInput;
  region: RegionEntity;
  regionCode: string;
  tile?: LayoutTile;
  layoutCols: number;
  layoutRows: number;
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

  if (input.placeFallback) return input.placeFallback;

  if (input.tile) {
    return layoutTileToCentroid(input.tile, input.layoutCols, input.layoutRows);
  }

  return undefined;
}
