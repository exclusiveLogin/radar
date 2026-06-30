/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking/nextgen
 * purpose: Kalman-огурец + гравитация — SSOT стоимости ребра Ф3 NextGen.
 * ---
 */
import { normalizedKalmanRho } from "../kalmanLocus";
import { scoreInnovation } from "../innovationScore";
import {
  observationCovarianceMeters,
  scaleObservationCovariance,
} from "../observationCovariance";
import { segmentVelocityMps } from "../rearFrontGate";
import type { FlowAlignmentWeights } from "../flowAlignment";
import type { ProfileKinematics } from "../profileKinematics";
import type { KalmanStateJson, TrajectoryNode } from "../types";
import type { NextGenNode } from "./phase1-stdbscan/NextGenPhase1";
import {
  evaluateLink,
  type LinkEvaluation,
  type TurnPenaltyConfig,
} from "./nextgenGravity";
import type { H3VectorFlowMap } from "./flow-map/H3VectorFlowMap";

/** Открытый трек из БД или текущего прогона — вход Ф3 joining. */
export type NextGenSeedTrack = {
  trackId: string;
  nodes: TrajectoryNode[];
  refLat: number;
  refLon: number;
  totalDistanceM: number;
};

export type NextGenLinkTrackContext = {
  refLat: number;
  refLon: number;
  kalmanState: KalmanStateJson | null;
  lastAt: Date;
  lastLat: number;
  lastLon: number;
  nearestFrontLat?: number | null;
  nearestFrontLon?: number | null;
  nodes: readonly TrajectoryNode[];
};

/**
 * Оценка ребра tail→node: сначала Kalman-локус (огурец), затем гравитация H3+ток.
 * Без kalmanState — только кинематика + среда (старт / segment_only история).
 */
export function evaluateNextGenLink(
  tail: NextGenLinkTrackContext,
  node: NextGenNode,
  kin: ProfileKinematics,
  flowMap: H3VectorFlowMap,
  weights: FlowAlignmentWeights,
  incomingBearingDeg: number | null | undefined,
  turn: TurnPenaltyConfig,
): LinkEvaluation | null {
  const gapMs = node.occurredAt.getTime() - tail.lastAt.getTime();
  if (gapMs <= 0 || gapMs > kin.maxGapMs) return null;

  const tailFlow = {
    lat: tail.lastLat,
    lon: tail.lastLon,
    occurredAt: tail.lastAt,
    nearestFrontLat: tail.nearestFrontLat,
    nearestFrontLon: tail.nearestFrontLon,
  };

  let kalmanFactor = 1;
  if (tail.kalmanState) {
    const R = scaleObservationCovariance(
      observationCovarianceMeters(node.precision, node.trust),
      kin.observationSigmaScale,
    );
    const locusCapSec = Math.max(kin.stdbscanEpsilonTemporalMs / 1000, 3600);
    const dtSeconds = Math.min(gapMs / 1000, locusCapSec);
    const prev = tail.nodes.length >= 2 ? tail.nodes[tail.nodes.length - 2]! : null;
    const segDt = prev
      ? (tail.lastAt.getTime() - prev.occurredAt.getTime()) / 1000
      : 0;
    const segVel =
      prev && segDt > 0
        ? segmentVelocityMps(prev.lat, prev.lon, tail.lastLat, tail.lastLon, segDt)
        : null;

    const scored = scoreInnovation({
      state: tail.kalmanState,
      observationLat: node.lat,
      observationLon: node.lon,
      dtSeconds,
      R,
      refLat: tail.refLat,
      refLon: tail.refLon,
      processNoiseScale: kin.processNoiseScale,
      chi2Threshold: kin.chi2Threshold,
      maxVelocityMs: kin.maxVelocityMs,
      rearThresholdM: kin.rearThresholdM,
      anisotropyRatio: kin.locusAnisotropyRatio,
      segmentVelocityMps: segVel,
      timeDecayTauMs: kin.maxGapMs / 2,
      lastTrackAtMs: tail.lastAt.getTime(),
      observedAtMs: node.occurredAt.getTime(),
    });

    if (scored.rejectReason || !scored.inLocus) return null;
    kalmanFactor = 1 + normalizedKalmanRho(scored.dM2, kin.chi2Threshold);
  }

  const gravity = evaluateLink(
    tailFlow,
    node,
    kin,
    flowMap,
    weights,
    incomingBearingDeg,
    turn,
  );
  if (!gravity) return null;

  return { cost: gravity.cost * kalmanFactor, alignment: gravity.alignment };
}
