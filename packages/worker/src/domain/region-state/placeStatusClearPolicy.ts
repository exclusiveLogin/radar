import type { LocationPrecision } from "@radar/shared";

export type ParsedLocationForClear = {
  regionId: string;
  placeId?: string;
  precision: LocationPrecision;
};

export type GreenPlaceClearPlan = {
  /** Регионы с отбоем уровня региона — сброс всех active places региона. */
  regionCascadeIds: string[];
  /** Явно упомянутые НП (district/city/…) — точечный сброс. */
  explicitPlaceIds: string[];
};

/**
 * План снятия place_status при отбое (green).
 *
 * Решение по `precision`, а НЕ по наличию placeId: резолвер прикрепляет
 * синтетический place даже к локации уровня региона (precision="region"),
 * поэтому проверка `if (placeId)` ошибочно уводила региональный отбой в
 * точечный сброс и не гасил дочерние НП.
 *
 * - precision="region" → каскад по всем active НП региона;
 * - иначе (district/city/locality/settlement) → точечный сброс по placeId.
 */
export function planGreenPlaceStatusClear(
  locations: ParsedLocationForClear[],
): GreenPlaceClearPlan {
  const regionCascadeIds = new Set<string>();
  const explicitPlaceIds = new Set<string>();

  for (const location of locations) {
    if (location.precision === "region") {
      regionCascadeIds.add(location.regionId);
      continue;
    }
    if (location.placeId) {
      explicitPlaceIds.add(location.placeId);
    }
  }

  return {
    regionCascadeIds: [...regionCascadeIds],
    explicitPlaceIds: [...explicitPlaceIds],
  };
}
