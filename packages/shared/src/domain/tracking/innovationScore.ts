/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: SSOT innovation score — Mahalanobis, S, timeDecay для attention и gate.
 * ---
 */
import { mahalanobis2, type Mat2 } from "./mat2";
import { isRearOfVelocity } from "./rearFrontGate";
import {
  innovationCovariance,
  latLonToMeters,
  predictKalmanState,
} from "./predictKalmanState";
import type { ObservationCovariance } from "./observationCovariance";
import type { KalmanStateJson } from "./types";

export type InnovationScoreInput = {
  state: KalmanStateJson;
  observationLat: number;
  observationLon: number;
  dtSeconds: number;
  R: ObservationCovariance;
  refLat: number;
  refLon: number;
  processNoiseScale: number;
  pauseFactor?: number;
  chi2Threshold: number;
  maxVelocityMs: number;
  rearThresholdM: number;
  /** Если Kalman vx≈0 — bearing последнего сегмента трека. */
  segmentVelocityMps?: [number, number] | null;
  /** τ для time decay; если задан lastTrackAt — decay = exp(-Δt/τ). */
  timeDecayTauMs?: number;
  lastTrackAtMs?: number;
  observedAtMs?: number;
};

export type InnovationScore = {
  dM2: number;
  dM: number;
  inLocus: boolean;
  S: Mat2;
  innov: [number, number];
  xPred: number;
  yPred: number;
  timeDecay: number;
  /** linkCost = dM2 / timeDecay */
  linkCost: number;
  rejectReason?: "max_velocity" | "rear_front";
};

/** Затухание претензии трека по времени молчания. */
export function computeTimeDecay(
  lastTrackAtMs: number,
  observedAtMs: number,
  tauMs: number,
): number {
  if (tauMs <= 0) return 1;
  const deltaMs = Math.max(0, observedAtMs - lastTrackAtMs);
  return Math.exp(-deltaMs / tauMs);
}

/**
 * Полный innovation score с predict + S + Mahalanobis.
 */
export function scoreInnovation(input: InnovationScoreInput): InnovationScore {
  const pauseFactor = input.pauseFactor ?? 1;
  const pred = predictKalmanState(
    input.state,
    input.dtSeconds,
    input.processNoiseScale,
    pauseFactor,
  );

  const obs = latLonToMeters(
    input.observationLat,
    input.observationLon,
    input.refLat,
    input.refLon,
  );

  const innov: [number, number] = [obs.xM - pred.xPred, obs.yM - pred.yPred];
  const dist = Math.hypot(innov[0], innov[1]);

  if (dist > input.maxVelocityMs * 2 * Math.max(input.dtSeconds, 1)) {
    return rejectScore(innov, pred, input.chi2Threshold, "max_velocity");
  }

  const speed = Math.hypot(pred.vxPred, pred.vyPred);
  const rearVx = speed > 0.1 ? pred.vxPred : input.segmentVelocityMps?.[0] ?? 0;
  const rearVy = speed > 0.1 ? pred.vyPred : input.segmentVelocityMps?.[1] ?? 0;
  if (isRearOfVelocity(innov[0], innov[1], rearVx, rearVy, input.rearThresholdM)) {
    return rejectScore(innov, pred, input.chi2Threshold, "rear_front");
  }

  const S = innovationCovariance(pred.PPred, input.R.sigmaLonM, input.R.sigmaLatM);
  const dM2 = mahalanobis2(innov, S);
  const dM = Math.sqrt(Math.max(0, dM2));

  let timeDecay = 1;
  if (
    input.timeDecayTauMs != null &&
    input.lastTrackAtMs != null &&
    input.observedAtMs != null
  ) {
    timeDecay = computeTimeDecay(input.lastTrackAtMs, input.observedAtMs, input.timeDecayTauMs);
  }

  const linkCost = timeDecay > 0 ? dM2 / timeDecay : dM2 * 1e6;

  return {
    dM2,
    dM,
    inLocus: dM2 <= input.chi2Threshold,
    S,
    innov,
    xPred: pred.xPred,
    yPred: pred.yPred,
    timeDecay,
    linkCost,
  };
}

function rejectScore(
  innov: [number, number],
  pred: { xPred: number; yPred: number },
  chi2: number,
  reason: "max_velocity" | "rear_front",
): InnovationScore {
  const huge = chi2 * 100;
  return {
    dM2: huge,
    dM: Math.sqrt(huge),
    inLocus: false,
    S: [[1, 0], [0, 1]],
    innov,
    xPred: pred.xPred,
    yPred: pred.yPred,
    timeDecay: 1,
    linkCost: huge,
    rejectReason: reason,
  };
}
