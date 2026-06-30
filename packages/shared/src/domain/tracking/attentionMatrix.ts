/**

 * ---

 * layer: shared

 * kind: domain

 * domain: tracking

 * purpose: Track-centric attention matrix — linkCost на основе Mahalanobis (S=P+R) и ρ' (ток).

 * ---

 */

import { haversineDistanceM } from "./haversine";

import { canEnterAttention } from "./trackingEligibility";

import { computeSeedScore, DEFAULT_SEED_WEIGHTS } from "./pointWeightModel";

import type { SeedWeights } from "./pointWeightModel";

import {

  applyFlowAlignment,

  DEFAULT_FLOW_ALIGNMENT,

  flowAlignmentCos,

  isCounterFlowRejected,

  resolveFlowBearingDeg,

  type FlowAlignmentWeights,

} from "./flowAlignment";

import {

  corridorBearingDeg,

  EMPTY_CORRIDOR_ROLLUP_INDEX,

  type CorridorRollupIndex,

} from "./flow/corridorRollupIndex";

import {

  applyMagnetWeights,

  DEFAULT_MAGNET_COST_WEIGHTS,

  EMPTY_MAGNETISM_INDEX,

  type MagnetCostWeights,

  type MagnetismIndex,

} from "./applyMagnetWeights";

import {

  inKalmanLocus,

  inKalmanSoftLocus,

  normalizedKalmanRho,

} from "./kalmanLocus";

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

  /** place_id последней ноды — lookup коридора P2P. */

  lastPlaceId: string | null;

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

  /** √(d²/χ²) — нормированный Mahalanobis. */

  rho: number;

  /** ρ с учётом тока/противотока — для выбора winner. */

  rhoPrime: number;

  /** d² Mahalanobis по S = H·P·Hᵀ + R. */

  dM2: number;

  inLocus: boolean;

  /** Мягкая линковка — d² ≤ 4χ² (ρ ≤ 2). */

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

  /** Веса географии seed (front-буст / interior-штраф / D0). */

  seedWeights?: SeedWeights;

  flowWeights?: FlowAlignmentWeights;

  /** Накопленные проходы по коридорам (L2); default — пустой. */

  corridorIndex?: CorridorRollupIndex;

  /** Магнетизм ST-DBSCAN (магнитная фаза). */

  magnetismIndex?: MagnetismIndex;

  magnetCost?: MagnetCostWeights;

  /** Максимум последовательных soft-линковок к треку до блокировки (default 2). */

  maxConsecutiveSoft?: number;

};



const SOFT_RHO_MULTIPLIER = 2;

export const DEFAULT_MAX_SOFT = 2;



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

  const seedWeights = opts.seedWeights ?? DEFAULT_SEED_WEIGHTS;

  const flowWeights = opts.flowWeights ?? DEFAULT_FLOW_ALIGNMENT;

  const corridorIndex = opts.corridorIndex ?? EMPTY_CORRIDOR_ROLLUP_INDEX;

  const magnetismIndex = opts.magnetismIndex ?? EMPTY_MAGNETISM_INDEX;

  const magnetCost = opts.magnetCost ?? DEFAULT_MAGNET_COST_WEIGHTS;

  const maxConsecutiveSoft = opts.maxConsecutiveSoft ?? DEFAULT_MAX_SOFT;

  const tauMs = kin.maxGapMs / 2;

  const rows: AttentionMatrixRow[] = [];



  for (const candidate of candidates) {

    if (consumed.has(candidate.eventLocationId)) continue;

    if (!canEnterAttention(candidate)) continue;



    const links: LinkCell[] = [];

    for (const track of tracks) {

      if (track.profile !== candidate.threatProfile) continue;

      const cell = scoreLinkCell(candidate, track, kin, tauMs, flowWeights, corridorIndex, magnetismIndex, magnetCost, maxConsecutiveSoft);

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



/** Оценка одной ячейки [point][track] — локус только по Kalman S. */

function scoreLinkCell(

  candidate: TrackingCandidate,

  track: TrackAttentionTarget,

  kin: ProfileKinematics,

  tauMs: number,

  flowWeights: FlowAlignmentWeights,

  corridorIndex: CorridorRollupIndex,

  magnetismIndex: MagnetismIndex,

  magnetCost: MagnetCostWeights,

  maxConsecutiveSoft: number,

): LinkCell | null {

  const gapMs = candidate.occurredAt.getTime() - track.lastAt.getTime();

  if (gapMs < 0 || gapMs > kin.maxGapMs) return null;



  const distM = haversineDistanceM(candidate.lat, candidate.lon, track.lastLat, track.lastLon);

  if (distM > kin.maxLinkDistanceM) return null;



  if (!track.kalmanState) return null;



  const R = scaleObservationCovariance(

    observationCovarianceMeters(candidate.precision, candidate.trust),

    kin.observationSigmaScale,

  );

  const locusCapSec = Math.max(kin.stdbscanEpsilonTemporalMs / 1000, 3600);
  const dtSeconds = Math.min(gapMs / 1000, locusCapSec);

  const chi2 = kin.chi2Threshold;



  const scored = scoreInnovation({

    state: track.kalmanState,

    observationLat: candidate.lat,

    observationLon: candidate.lon,

    dtSeconds,

    R,

    refLat: track.refLat,

    refLon: track.refLon,

    processNoiseScale: kin.processNoiseScale,

    pauseFactor: 1,

    chi2Threshold: chi2,

    maxVelocityMs: kin.maxVelocityMs,

    rearThresholdM: kin.rearThresholdM,

    anisotropyRatio: kin.locusAnisotropyRatio,

    segmentVelocityMps: track.segmentVelocityMps,

    timeDecayTauMs: tauMs,

    lastTrackAtMs: track.lastAt.getTime(),

    observedAtMs: candidate.occurredAt.getTime(),

  });



  if (scored.rejectReason) return null;



  const mutation = track.mutationState;

  const softBlocked = (mutation?.consecutiveSoftAssigns ?? 0) >= maxConsecutiveSoft;



  const rho = normalizedKalmanRho(scored.dM2, chi2);

  const corridorEntry =

    track.lastPlaceId && candidate.placeId

      ? corridorIndex.lookup(track.lastPlaceId, candidate.placeId, track.profile)

      : null;

  const corridor =

    corridorEntry != null

      ? { count: corridorEntry.count, bearingDeg: corridorBearingDeg(corridorEntry) }

      : null;

  const flowBearing = resolveFlowBearingDeg(

    candidate.lat,

    candidate.lon,

    candidate.nearestFrontLat,

    candidate.nearestFrontLon,

    corridor,

    flowWeights,

  );

  const alignCos =

    flowBearing != null

      ? flowAlignmentCos(track.lastLat, track.lastLon, candidate.lat, candidate.lon, flowBearing)

      : 0;

  // Жёсткий запрет противотока: шаг к фронту (Украине) отклоняется на уровне gate.
  if (flowBearing != null && isCounterFlowRejected(alignCos, flowWeights)) return null;

  const rhoPrime = applyFlowAlignment(rho, alignCos, flowWeights);

  const inLocus = inKalmanLocus(scored.dM2, chi2);

  const softEligible =

    !softBlocked && !inLocus && inKalmanSoftLocus(scored.dM2, chi2, SOFT_RHO_MULTIPLIER);

  const timeDecay = scored.timeDecay;

  const baseLinkCost = timeDecay > 0 ? rhoPrime / timeDecay : rhoPrime * 1e6;

  const linkCost = applyMagnetWeights(

    baseLinkCost,

    candidate.eventLocationId,

    magnetismIndex,

    magnetCost,

    alignCos,

  );



  return {

    trackId: track.trackId,

    linkCost,

    rho,

    rhoPrime,

    dM2: scored.dM2,

    inLocus,

    softEligible,

  };

}


