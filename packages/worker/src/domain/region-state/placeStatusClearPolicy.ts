export type ParsedLocationForClear = { regionId: string; placeId?: string };

export type GreenPlaceClearPlan = {
  /** Регионы с отбоем без НП в сообщении — сброс всех active places региона. */
  regionCascadeIds: string[];
  /** Явно упомянутые НП — точечный сброс. */
  explicitPlaceIds: string[];
};

/**
 * План снятия place_status при отбое (green).
 * Регион без placeId в локациях → каскад по всем детям; иначе только перечисленные НП.
 */
export function planGreenPlaceStatusClear(
  locations: ParsedLocationForClear[],
): GreenPlaceClearPlan {
  const regionOnlyIds = new Set<string>();
  const explicitPlaceIds = new Set<string>();

  for (const location of locations) {
    if (location.placeId) {
      explicitPlaceIds.add(location.placeId);
      continue;
    }
    regionOnlyIds.add(location.regionId);
  }

  return {
    regionCascadeIds: [...regionOnlyIds],
    explicitPlaceIds: [...explicitPlaceIds],
  };
}
