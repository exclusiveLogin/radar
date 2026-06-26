/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: Универсальная весовая модель seedScore = Π коэффициентов.
 * ---
 */
import { getEventTypeCoeffs } from "./eventTypeCoefficients";
import type { TrackingCandidate } from "./types";

export const REGION_COEFF_FRONT = 1.25;
// Тыл РФ — почти весь оперативный трафик идёт по тыловым регионам (diag: 50/51 точек).
// Прежний 0.35 полностью блокировал seed тыла → треки не зарождались за фронтом.
export const REGION_COEFF_INTERIOR_RF = 0.75;
export const REGION_COEFF_DEFAULT = 1.0;
// Порог seed снижен: данные — разрежённые centroid-точки, высокий порог не пускал тыл.
export const DEFAULT_SEED_MIN = 0.25;

// Масштаб затухания близости к фронту (км): на ~400 км буст спадает в e раз.
export const FRONT_PROXIMITY_D0_KM = 400;

/** C_geo по precision (trust — вторичный множитель). */
export function computeGeoCoeff(precision: string, trust: number): number {
  let base: number;
  switch (precision) {
    case "locality_with_coords":
    case "coords":
      base = 1.0;
      break;
    case "city":
      base = 0.7;
      break;
    case "vicinity":
      // Осознанный 5км-скоуп «около» — конкретнее, чем unknown; не путать с дефолтом.
      base = 0.6;
      break;
    case "locality":
    case "settlement":
      base = 0.5;
      break;
    default:
      base = 0.4;
  }
  const trustFactor = 0.5 + 0.5 * Math.min(1, Math.max(0, trust));
  return base * trustFactor;
}

/** C_region: фронт / глубина РФ / прочее (boolean-фолбэк, см. computeFrontProximityCoeff). */
export function computeRegionCoeff(isFrontRegion: boolean, isInteriorRf: boolean): number {
  if (isFrontRegion) return REGION_COEFF_FRONT;
  if (isInteriorRf) return REGION_COEFF_INTERIOR_RF;
  return REGION_COEFF_DEFAULT;
}

/**
 * Непрерывный C_region по близости к фронту: мультипликативный буст, плавно
 * затухающий с дистанцией до ближайшего фронт-региона.
 *
 *   coeff(d) = INTERIOR + (FRONT − INTERIOR) · exp(−d / D0)
 *
 * d=0 (фронт) → FRONT; d→∞ (глубокий тыл) → INTERIOR. Приграничье (Белгород,
 * Курск, Краснодар) получает высокий вес автоматически, без хардкода флагов.
 */
export function computeFrontProximityCoeff(distanceKm: number): number {
  const d = Math.max(0, distanceKm);
  const span = REGION_COEFF_FRONT - REGION_COEFF_INTERIOR_RF;
  return REGION_COEFF_INTERIOR_RF + span * Math.exp(-d / FRONT_PROXIMITY_D0_KM);
}

/**
 * seedScore = seedMult(type) × C_geo × C_region.
 * C_region: при наличии frontDistanceKm — непрерывный коэффициент близости;
 * иначе boolean-фолбэк (обратная совместимость для незаполненных регионов).
 */
export function computeSeedScore(candidate: TrackingCandidate): number {
  const { seedMult } = getEventTypeCoeffs(candidate.eventType);
  if (seedMult <= 0) return 0;
  const cGeo = computeGeoCoeff(candidate.precision, candidate.trust);
  const cRegion =
    candidate.frontDistanceKm != null
      ? computeFrontProximityCoeff(candidate.frontDistanceKm)
      : computeRegionCoeff(candidate.isFrontRegion, candidate.isInteriorRf ?? false);
  return seedMult * cGeo * cRegion;
}

/** Проходит ли точка порог для new track. */
export function passesSeedThreshold(
  candidate: TrackingCandidate,
  seedMin: number = DEFAULT_SEED_MIN,
): boolean {
  return computeSeedScore(candidate) >= seedMin;
}
