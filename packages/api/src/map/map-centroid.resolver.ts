import { layoutTileToCentroid } from "@radar/shared";
import type { LayoutTile, StateLevel } from "@radar/shared";
import type { RegionEntity } from "../geo/entities";

function toNumber(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

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
