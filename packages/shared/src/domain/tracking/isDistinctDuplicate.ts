/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: Детекция дублей в рамках одного трека (DISTINCT gate).
 *          Если кандидат — дубль последней ноды, его source_refs сливаются,
 *          Kalman.correct() не вызывается.
 * ---
 */
import { haversineDistanceM } from "./haversine";
import { observationCovarianceMeters } from "./observationCovariance";
import type { TrajectoryNode, TrackingCandidate } from "./types";

/** Минимальный радиус дедупликации (м), если sigma слишком мала. */
const DISTINCT_RADIUS_MIN_M = 500;

/** Базовое временное окно дедупликации (мс). */
export const TRACKING_DISTINCT_WINDOW_MS = 600_000; // 10 мин

type DistinctCheckInput = {
  lastNode: Pick<TrajectoryNode, "lat" | "lon" | "placeId" | "occurredAt" | "mode">;
  candidate: Pick<
    TrackingCandidate,
    "lat" | "lon" | "placeId" | "occurredAt" | "mode" | "precision" | "trust"
  >;
  windowMs?: number;
};

/**
 * Возвращает true если кандидат считается дублем последней ноды.
 *
 * Условия (все должны выполняться):
 * - оба кинематических (mode=correct)
 * - временной разрыв ≤ windowMs
 * - одинаковый place_id (если оба заданы) ИЛИ haversine ≤ distinctRadius
 */
export function isDistinctDuplicate(input: DistinctCheckInput): boolean {
  const { lastNode, candidate, windowMs = TRACKING_DISTINCT_WINDOW_MS } = input;

  if (lastNode.mode !== "correct" || candidate.mode !== "correct") return false;

  const deltaMs =
    candidate.occurredAt.getTime() - lastNode.occurredAt.getTime();
  if (deltaMs < 0 || deltaMs > windowMs) return false;

  if (lastNode.placeId && candidate.placeId) {
    return lastNode.placeId === candidate.placeId;
  }

  const { sigmaLatM } = observationCovarianceMeters(candidate.precision, candidate.trust);
  const radius = Math.max(sigmaLatM, DISTINCT_RADIUS_MIN_M);
  const dist = haversineDistanceM(lastNode.lat, lastNode.lon, candidate.lat, candidate.lon);

  return dist <= radius;
}
