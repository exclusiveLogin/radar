/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: Innovation gate для Kalman — проверяет допустимость нового наблюдения
 *          через расстояние Махаланобиса и rear-front тест.
 * ---
 */
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
  /** Максимально допустимая скорость (м/с) — из ProfileKinematics. */
  maxVelocityMs: number;
  chi2Threshold?: number;
  /** Ширина rear-front кольца вдоль скорости, м — из ProfileKinematics. */
  rearThresholdM?: number;
};

/**
 * Проверяет, может ли наблюдение быть принято в трек.
 *
 * 1. Скоростной pre-check: если дистанция/dt > maxVelocityMs × 2 → reject.
 * 2. Rear-front: если наблюдение «позади» вектора скорости дальше rearThresholdM → reject.
 * 3. Mahalanobis² < chi2Threshold → accept.
 */
export function innovationGate(input: GateInput): GateResult {
  const {
    state,
    observationLat,
    observationLon,
    R,
    maxVelocityMs,
    chi2Threshold = DEFAULT_CHI2_THRESHOLD,
    rearThresholdM = LEGACY_REAR_THRESHOLD_M,
  } = input;

  const metersPerDegLat = 111_320;
  const metersPerDegLon = 111_320 * Math.cos((observationLat * Math.PI) / 180);

  const dx = (observationLon - state.x / metersPerDegLon) * metersPerDegLon;
  const dy = (observationLat - state.y / metersPerDegLat) * metersPerDegLat;

  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > maxVelocityMs * 2 * 3600) return { accept: false, reason: "max_velocity" };

  const speed = Math.sqrt(state.vx ** 2 + state.vy ** 2);
  if (speed > 0.1) {
    const dot = (dx * state.vx + dy * state.vy) / speed;
    if (dot < -rearThresholdM) return { accept: false, reason: "rear_front" };
  }

  const sigX = R.sigmaLonM;
  const sigY = R.sigmaLatM;
  const mahal2 = (dx / sigX) ** 2 + (dy / sigY) ** 2;

  if (mahal2 > chi2Threshold) return { accept: false, reason: "mahalanobis" };

  return { accept: true };
}
