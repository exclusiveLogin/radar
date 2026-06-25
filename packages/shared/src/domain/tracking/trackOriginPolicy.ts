/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: Политика выбора seed-точки для нового трека (origin gate).
 *          Фаза 1: spatial velocity gate (без P-matrix).
 *          Фаза 2+: заменить на isInsideAnyActivePrediction() с P-matrix.
 * ---
 */
import { haversineDistanceM } from "./haversine";
import type { ProfileKinematics } from "./profileKinematics";
import type { TrackingCandidate } from "./types";

/** Открытый трек для проверки overlap при старте нового трека. */
export type OpenTrackSummary = {
  lastLat: number;
  lastLon: number;
  lastAt: Date;
  profile: import("./types").ThreatProfile;
};

/**
 * Scoring seed-кандидата: чем выше — тем приоритетнее как стартовая точка трека.
 *
 * Факторы:
 * - front_region: +100 (boost, не обязательное условие)
 * - mode=correct: +50
 * - point precision (coords): +30
 */
export function scoreSeedCandidate(candidate: TrackingCandidate): number {
  let score = 0;
  if (candidate.isFrontRegion) score += 100;
  if (candidate.mode === "correct") score += 50;
  if (candidate.precision === "locality_with_coords") score += 30;
  else if (candidate.precision === "city") score += 20;
  else if (candidate.precision === "locality") score += 10;
  return score;
}

/**
 * Проверяет, находится ли кандидат слишком близко к последней известной позиции
 * любого open-трека в пределах maxGapMs.
 *
 * Если да — кандидат должен пытаться прилинковаться к существующему треку,
 * а не стартовать новый.
 *
 * Фаза 1: простой spatial gate (haversine < maxLinkDistanceM × 0.5).
 * Фаза 2+: заменить на полноценный prediction ellipse gate с kalman_state.P.
 */
export function isNearAnyOpenTrack(
  candidate: TrackingCandidate,
  openTracks: OpenTrackSummary[],
  profile: ProfileKinematics,
): boolean {
  const threshold = profile.maxLinkDistanceM * 0.5;

  for (const track of openTracks) {
    const gapMs = candidate.occurredAt.getTime() - track.lastAt.getTime();
    if (gapMs < 0 || gapMs > profile.maxGapMs) continue;

    const dist = haversineDistanceM(
      candidate.lat,
      candidate.lon,
      track.lastLat,
      track.lastLon,
    );
    if (dist <= threshold) return true;
  }

  return false;
}
