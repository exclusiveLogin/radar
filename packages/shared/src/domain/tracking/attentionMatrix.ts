/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: Track-centric attention matrix — linkCost = D_M² / timeDecay для каждой пары point×track.
 * ---
 */
import { haversineDistanceM } from "./haversine";
import { latLonToMeters } from "./predictKalmanState";
import { isRearOfVelocity } from "./rearFrontGate";
import { canEnterAttention } from "./trackingEligibility";
import { computeSeedScore, DEFAULT_SEED_WEIGHTS } from "./pointWeightModel";
import type { SeedWeights } from "./pointWeightModel";
import { scoreInnovation } from "./innovationScore";
import {
  observationCovarianceMeters,
  scaleObservationCovariance,
} from "./observationCovariance";
import type { ProfileKinematics } from "./profileKinematics";
import type { KalmanStateJson, TrackingCandidate, ThreatProfile } from "./types";
import type { MutationState } from "./types";

export type TrackAttentionTarget = {
  trackId: string;
  profile: ThreatProfile;
  lastAt: Date;
  lastLat: number;
  lastLon: number;
  kalmanState: KalmanStateJson | null;
  refLat: number;
  refLon: number;
  mutationState?: MutationState;
  /** Скорость последнего сегмента — rear gate при vx≈0 в Kalman. */
  segmentVelocityMps?: [number, number] | null;
};

export type LinkCell = {
  trackId: string;
  linkCost: number;
  dM2: number;
  inLocus: boolean;
  /** Мягкая линковка — вне strict gate, но в расширенном локусе. */
  softEligible: boolean;
};

export type AttentionMatrixRow = {
  candidate: TrackingCandidate;
  links: LinkCell[];
  seedScore: number;
};

export type BuildMatrixOpts = {
  consumed?: Set<string>;
  seedMin?: number;
  pauseFactor?: number;
  pauseFactorCap?: number;
  /** Веса географии seed (front-буст / interior-штраф / D0). */
  seedWeights?: SeedWeights;
};

const DEFAULT_PAUSE_FACTOR = 4.0;
const DEFAULT_PAUSE_CAP = 9.0;

/**
 * Строит строки attention-матрицы для батча кандидатов.
 * Пропускает consumed и ineligible точки.
 */
export function buildAttentionMatrix(
  candidates: TrackingCandidate[],
  tracks: TrackAttentionTarget[],
  kin: ProfileKinematics,
  opts: BuildMatrixOpts = {},
): AttentionMatrixRow[] {
  const consumed = opts.consumed ?? new Set<string>();
  const pauseFactor = opts.pauseFactor ?? DEFAULT_PAUSE_FACTOR;
  const pauseCap = opts.pauseFactorCap ?? DEFAULT_PAUSE_CAP;
  const seedWeights = opts.seedWeights ?? DEFAULT_SEED_WEIGHTS;
  const tauMs = kin.maxGapMs / 2;
  const rows: AttentionMatrixRow[] = [];

  for (const candidate of candidates) {
    if (consumed.has(candidate.eventLocationId)) continue;
    if (!canEnterAttention(candidate)) continue;
    if (candidate.threatProfile !== tracks[0]?.profile && tracks.length > 0) {
      // профиль фильтруется per-batch в worker; здесь — per-candidate
    }

    const links: LinkCell[] = [];
    for (const track of tracks) {
      if (track.profile !== candidate.threatProfile) continue;
      const cell = scoreLinkCell(candidate, track, kin, tauMs, pauseFactor, pauseCap);
      if (cell) links.push(cell);
    }

    rows.push({
      candidate,
      links,
      seedScore: computeSeedScore(candidate, seedWeights),
    });
  }

  return rows;
}

/** Оценка одной ячейки [point][track]. */
function scoreLinkCell(
  candidate: TrackingCandidate,
  track: TrackAttentionTarget,
  kin: ProfileKinematics,
  tauMs: number,
  pauseFactor: number,
  pauseCap: number,
): LinkCell | null {
  const gapMs = candidate.occurredAt.getTime() - track.lastAt.getTime();
  if (gapMs < 0 || gapMs > kin.maxGapMs) return null;

  const distM = haversineDistanceM(candidate.lat, candidate.lon, track.lastLat, track.lastLon);
  if (distM > kin.maxLinkDistanceM) return null;

  const R = scaleObservationCovariance(
    observationCovarianceMeters(candidate.precision, candidate.trust),
    kin.observationSigmaScale,
  );

  const mutation = track.mutationState;
  const qPause =
    mutation?.phase === "expanded"
      ? Math.min(pauseCap, pauseFactor * (mutation.consecutiveSoftAssigns + 1))
      : 1;

  const maxSoft = 2;
  const softBlocked = (mutation?.consecutiveSoftAssigns ?? 0) >= maxSoft;

  if (track.kalmanState) {
    const dtSeconds = gapMs / 1000;
    const scored = scoreInnovation({
      state: track.kalmanState,
      observationLat: candidate.lat,
      observationLon: candidate.lon,
      dtSeconds,
      R,
      refLat: track.refLat,
      refLon: track.refLon,
      processNoiseScale: kin.processNoiseScale,
      pauseFactor: qPause,
      chi2Threshold: kin.chi2Threshold,
      maxVelocityMs: kin.maxVelocityMs,
      rearThresholdM: kin.rearThresholdM,
      segmentVelocityMps: track.segmentVelocityMps,
      timeDecayTauMs: tauMs,
      lastTrackAtMs: track.lastAt.getTime(),
      observedAtMs: candidate.occurredAt.getTime(),
    });

    if (scored.rejectReason) return null;

    const softThreshold = kin.chi2Threshold * Math.min(pauseCap, pauseFactor);
    const softEligible = !softBlocked && !scored.inLocus && scored.dM2 <= softThreshold;

    return {
      trackId: track.trackId,
      linkCost: scored.linkCost,
      dM2: scored.dM2,
      inLocus: scored.inLocus,
      softEligible,
    };
  }

  // Fallback без Kalman — haversine + rear по последнему сегменту
  const obs = latLonToMeters(candidate.lat, candidate.lon, track.refLat, track.refLon);
  const lastM = latLonToMeters(track.lastLat, track.lastLon, track.refLat, track.refLon);
  const innov: [number, number] = [obs.xM - lastM.xM, obs.yM - lastM.yM];
  if (
    track.segmentVelocityMps
    && isRearOfVelocity(
      innov[0],
      innov[1],
      track.segmentVelocityMps[0],
      track.segmentVelocityMps[1],
      kin.rearThresholdM,
    )
  ) {
    return null;
  }

  const normD2 = (distM / Math.max(kin.maxLinkDistanceM, 1)) ** 2 * kin.chi2Threshold;
  const timeDecay = Math.exp(-Math.max(0, gapMs) / tauMs);
  const linkCost = timeDecay > 0 ? normD2 / timeDecay : normD2 * 1e6;
  const inLocus = normD2 <= kin.chi2Threshold;
  const softThreshold = kin.chi2Threshold * Math.min(pauseCap, pauseFactor);

  return {
    trackId: track.trackId,
    linkCost,
    dM2: normD2,
    inLocus,
    softEligible: !softBlocked && !inLocus && normD2 <= softThreshold,
  };
}
