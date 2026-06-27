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

export const REGION_COEFF_FRONT = 1.35;
// Тыл РФ: пониженный вес seed — сопротивление обратному распространению потока.
export const REGION_COEFF_INTERIOR_RF = 0.5;
export const REGION_COEFF_DEFAULT = 1.0;
// Выше порог — меньше зарождений в глубине без сильного сигнала.
export const DEFAULT_SEED_MIN = 0.38;
/** Seed только вблизи фронта (км от ближайшего front_region). */
export const DEFAULT_SEED_MAX_FRONT_DISTANCE_KM = 450;

// Масштаб затухания близости к фронту (км): на ~400 км буст спадает в e раз.
export const FRONT_PROXIMITY_D0_KM = 400;

/**
 * Настраиваемые веса зарождения трека по географии (из админки).
 * Управляют «штрафом за seed в тылу» и «бустом у фронта».
 */
export type SeedWeights = {
  /** Множитель веса у фронт-региона (буст). По умолчанию 1.35. */
  regionFront: number;
  /** Множитель веса в глубине РФ (штраф < 1 — гасит обратный seed). По умолчанию 0.5. */
  regionInteriorRf: number;
  /** Длина затухания близости к фронту, км (exp(−d/D0)). По умолчанию 400. */
  frontProximityD0Km: number;
};

export const DEFAULT_SEED_WEIGHTS: SeedWeights = {
  regionFront: REGION_COEFF_FRONT,
  regionInteriorRf: REGION_COEFF_INTERIOR_RF,
  frontProximityD0Km: FRONT_PROXIMITY_D0_KM,
};

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
export function computeRegionCoeff(
  isFrontRegion: boolean,
  isInteriorRf: boolean,
  weights: SeedWeights = DEFAULT_SEED_WEIGHTS,
): number {
  if (isFrontRegion) return weights.regionFront;
  if (isInteriorRf) return weights.regionInteriorRf;
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
export function computeFrontProximityCoeff(
  distanceKm: number,
  weights: SeedWeights = DEFAULT_SEED_WEIGHTS,
): number {
  const d = Math.max(0, distanceKm);
  const span = weights.regionFront - weights.regionInteriorRf;
  return weights.regionInteriorRf + span * Math.exp(-d / weights.frontProximityD0Km);
}

/**
 * seedScore = seedMult(type) × C_geo × C_region.
 * C_region: при наличии frontDistanceKm — непрерывный коэффициент близости;
 * иначе boolean-фолбэк (обратная совместимость для незаполненных регионов).
 */
export function computeSeedScore(
  candidate: TrackingCandidate,
  weights: SeedWeights = DEFAULT_SEED_WEIGHTS,
): number {
  const { seedMult } = getEventTypeCoeffs(candidate.eventType);
  if (seedMult <= 0) return 0;
  const cGeo = computeGeoCoeff(candidate.precision, candidate.trust);
  const cRegion =
    candidate.frontDistanceKm != null
      ? computeFrontProximityCoeff(candidate.frontDistanceKm, weights)
      : computeRegionCoeff(candidate.isFrontRegion, candidate.isInteriorRf ?? false, weights);
  return seedMult * cGeo * cRegion;
}

/** Проходит ли точка порог для new track. */
export function passesSeedThreshold(
  candidate: TrackingCandidate,
  seedMin: number = DEFAULT_SEED_MIN,
  weights: SeedWeights = DEFAULT_SEED_WEIGHTS,
): boolean {
  return computeSeedScore(candidate, weights) >= seedMin;
}

/**
 * Можно ли стартовать новый трек из точки.
 * В глубине РФ (далеко от фронта) — только link к существующему, не seed.
 */
export function canSeedCandidate(
  candidate: TrackingCandidate,
  seedMin: number = DEFAULT_SEED_MIN,
  maxFrontDistanceKm: number = DEFAULT_SEED_MAX_FRONT_DISTANCE_KM,
  weights: SeedWeights = DEFAULT_SEED_WEIGHTS,
): boolean {
  const { seedMult } = getEventTypeCoeffs(candidate.eventType);
  if (seedMult <= 0) return false;
  if (!passesSeedThreshold(candidate, seedMin, weights)) return false;

  if (candidate.frontDistanceKm != null) {
    return candidate.frontDistanceKm <= maxFrontDistanceKm;
  }

  if (candidate.isFrontRegion) return true;
  if (candidate.isInteriorRf) {
    return computeSeedScore(candidate, weights) >= seedMin * 1.6;
  }
  return true;
}
