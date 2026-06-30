/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking/flow
 * purpose: Гибридный ключ зоны для place gravity — place_id или geohash.
 * ---
 */

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

/** Кодирует lat/lon в geohash заданной точности (символов). */
export function encodeGeohash(lat: number, lon: number, precision: number): string {
  const p = Math.max(1, Math.min(12, Math.floor(precision)));
  let idx = 0;
  let bit = 0;
  let even = true;
  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;
  let hash = "";

  while (hash.length < p) {
    if (even) {
      const mid = (lonMin + lonMax) / 2;
      if (lon >= mid) {
        idx = idx * 2 + 1;
        lonMin = mid;
      } else {
        idx = idx * 2;
        lonMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        idx = idx * 2 + 1;
        latMin = mid;
      } else {
        idx = idx * 2;
        latMax = mid;
      }
    }
    even = !even;
    if (++bit === 5) {
      hash += BASE32[idx]!;
      bit = 0;
      idx = 0;
    }
  }
  return hash;
}

/** Гибрид C: place_id при наличии, иначе geohash. */
export function zoneKeyForCandidate(
  placeId: string | null,
  lat: number,
  lon: number,
  geohashPrecision: number,
): string {
  if (placeId) return `place:${placeId}`;
  return `geo:${encodeGeohash(lat, lon, geohashPrecision)}`;
}
