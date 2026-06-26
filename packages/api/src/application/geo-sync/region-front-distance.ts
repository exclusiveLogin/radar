/**
 * ---
 * layer: api/application
 * domain: geo-sync
 * purpose: Расчёт regions.front_distance_km — минимальной гео-дистанции от центроида
 *          региона до ближайшего фронт-региона. Data-driven вход для веса близости
 *          к фронту в tracking-домене (computeFrontProximityCoeff).
 * ---
 */
import { haversineDistanceM } from "@radar/shared";

/** Минимум геоданных региона для расчёта дистанции до фронта. */
export type RegionGeoPoint = {
  iso: string;
  centroidLat?: number;
  centroidLon?: number;
  frontRegion: boolean;
};

/**
 * Возвращает Map(iso → дистанция в км до ближайшего фронт-региона).
 *
 * - Сам фронт-регион → 0 (он и есть фронт).
 * - Регион без центроида или при отсутствии фронт-центроидов в наборе → отсутствует
 *   в Map (вызывающий трактует как «нет данных» → домен падает на boolean-фолбэк).
 */
export function computeFrontDistancesKm(
  regions: RegionGeoPoint[],
): Map<string, number> {
  const frontCentroids = regions.filter(
    (r) => r.frontRegion && r.centroidLat !== undefined && r.centroidLon !== undefined,
  );

  const result = new Map<string, number>();
  if (frontCentroids.length === 0) return result;

  for (const region of regions) {
    if (region.centroidLat === undefined || region.centroidLon === undefined) continue;
    if (region.frontRegion) {
      result.set(region.iso, 0);
      continue;
    }

    let minMeters = Infinity;
    for (const front of frontCentroids) {
      const meters = haversineDistanceM(
        region.centroidLat,
        region.centroidLon,
        front.centroidLat!,
        front.centroidLon!,
      );
      if (meters < minMeters) minMeters = meters;
    }
    result.set(region.iso, Math.round(minMeters / 100) / 10);
  }

  return result;
}
