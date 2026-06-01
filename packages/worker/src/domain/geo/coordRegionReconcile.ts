import type { EventLocation, RegionRecord } from "@radar/shared";
import { canonicalRegionCode } from "@radar/shared";

/** Порог: координаты дальше — субъект из текста не доверяем, берём геокодер/ближайший регион. */
const MAX_KM_TEXT_REGION_VS_COORDS = 280;

const TRUSTED_GEO_SOURCES = new Set<EventLocation["source"]>([
  "dadata",
  "nominatim",
]);

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Расстояние между точками (км), haversine. */
export function distanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const r = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

export function isTrustedGeocodeSource(
  source: EventLocation["source"],
): boolean {
  return TRUSTED_GEO_SOURCES.has(source);
}

function regionCentroid(region: RegionRecord): { lat: number; lon: number } | null {
  if (region.centroidLat == null || region.centroidLon == null) {
    return null;
  }
  return { lat: region.centroidLat, lon: region.centroidLon };
}

/** Координаты согласованы с центроидом субъекта (грубо, без полигонов). */
export function isCoordConsistentWithRegion(
  lat: number,
  lon: number,
  region: RegionRecord,
): boolean {
  const centroid = regionCentroid(region);
  if (!centroid) {
    return true;
  }
  return (
    distanceKm(lat, lon, centroid.lat, centroid.lon) <= MAX_KM_TEXT_REGION_VS_COORDS
  );
}

/** Ближайший активный субъект по центроиду (fallback без bbox). */
export function findNearestRegionByCoords(
  lat: number,
  lon: number,
  regions: RegionRecord[],
): RegionRecord | null {
  let best: RegionRecord | null = null;
  let bestKm = Infinity;

  for (const region of regions) {
    const centroid = regionCentroid(region);
    if (!centroid) {
      continue;
    }
    const km = distanceKm(lat, lon, centroid.lat, centroid.lon);
    if (km < bestKm) {
      bestKm = km;
      best = region;
    }
  }

  if (!best || bestKm > MAX_KM_TEXT_REGION_VS_COORDS) {
    return null;
  }
  return best;
}

/**
 * Эффективный regionCode: при конфликте текста и геокодера побеждают coords
 * (DaData region_iso_code или ближайший субъект).
 */
export function resolveRegionCodeForCoords(
  location: EventLocation,
  textRegion: RegionRecord | null,
  allRegions: RegionRecord[],
): string | null {
  const { lat, lon } = location;
  if (lat == null || lon == null || !isTrustedGeocodeSource(location.source)) {
    return null;
  }

  const codeFromLocation = location.regionCode?.trim() ?? "";
  const fromGeocoder = allRegions.find(
    (r) =>
      r.iso === codeFromLocation
      || r.code === codeFromLocation
      || canonicalRegionCode(r) === codeFromLocation,
  );

  if (textRegion && !isCoordConsistentWithRegion(lat, lon, textRegion)) {
    if (
      fromGeocoder
      && isCoordConsistentWithRegion(lat, lon, fromGeocoder)
    ) {
      return canonicalRegionCode(fromGeocoder);
    }
    const nearest = findNearestRegionByCoords(lat, lon, allRegions);
    return nearest ? canonicalRegionCode(nearest) : null;
  }

  if (textRegion) {
    return canonicalRegionCode(textRegion);
  }

  return fromGeocoder ? canonicalRegionCode(fromGeocoder) : codeFromLocation || null;
}
