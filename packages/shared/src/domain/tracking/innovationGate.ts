/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: Innovation gate — делегирует scoreInnovation (полный S = H·P·Hᵀ + R).
 * ---
 */
import { scoreInnovation } from "./innovationScore";
import type { KalmanStateJson } from "./types";
import type { ObservationCovariance } from "./observationCovariance";

/** Chi² порог для 2D gate: 99% confidence = 9.21 (сенсорная сеть). */
export const DEFAULT_CHI2_THRESHOLD = 9.21;

/** Legacy rear-front — слишком узко для OSINT; дефолт в профиле 20–50 км. */
export const LEGACY_REAR_THRESHOLD_M = 500;

export type GateResult =
  | { accept: true }
  | { accept: false; reason: "mahalanobis" | "rear_front" | "max_velocity" };

type GateInput = {
  state: KalmanStateJson;
  observationLat: number;
  observationLon: number;
  observedAt: Date;
  R: ObservationCovariance;
  refLat: number;
  refLon: number;
  /** Максимально допустимая скорость (м/с) — из ProfileKinematics. */
  maxVelocityMs: number;
  chi2Threshold?: number;
  rearThresholdM?: number;
  processNoiseScale?: number;
  dtSeconds?: number;
  /** σ_along/σ_cross — ориентация зоны вдоль скорости (≥1). */
  anisotropyRatio?: number;
};

/**
 * Проверяет, может ли наблюдение быть принято в трек (delegates innovationScore).
 */
export function innovationGate(input: GateInput): GateResult {
  const {
    state,
    observationLat,
    observationLon,
    R,
    refLat,
    refLon,
    maxVelocityMs,
    chi2Threshold = DEFAULT_CHI2_THRESHOLD,
    rearThresholdM = LEGACY_REAR_THRESHOLD_M,
    processNoiseScale = 1,
    dtSeconds = 1,
    anisotropyRatio,
  } = input;

  const scored = scoreInnovation({
    state,
    observationLat,
    observationLon,
    dtSeconds,
    R,
    refLat,
    refLon,
    processNoiseScale,
    chi2Threshold,
    maxVelocityMs,
    rearThresholdM,
    anisotropyRatio,
  });

  if (scored.rejectReason === "max_velocity") {
    return { accept: false, reason: "max_velocity" };
  }
  if (scored.rejectReason === "rear_front") {
    return { accept: false, reason: "rear_front" };
  }
  if (!scored.inLocus) {
    return { accept: false, reason: "mahalanobis" };
  }

  return { accept: true };
}
