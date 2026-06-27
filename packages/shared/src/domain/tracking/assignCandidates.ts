/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: Phase B resolve — in-locus / soft / seed / intercept + consumed SSOT.
 * ---
 */
import { shouldTerminateOnAttach } from "./eventTypeCoefficients";
import {
  canSeedCandidate,
  DEFAULT_SEED_MAX_FRONT_DISTANCE_KM,
  DEFAULT_SEED_WEIGHTS,
  passesSeedThreshold,
  DEFAULT_SEED_MIN,
} from "./pointWeightModel";
import type { SeedWeights } from "./pointWeightModel";
import {
  buildAttentionMatrix,
  type AttentionMatrixRow,
  type TrackAttentionTarget,
} from "./attentionMatrix";
import type { ProfileKinematics } from "./profileKinematics";
import type { TrackingCandidate } from "./types";

export const DEFAULT_TIE_EPSILON = 0.5;
export const DEFAULT_MAX_CONSECUTIVE_SOFT = 2;

export type AssignDecision =
  | { kind: "link"; candidate: TrackingCandidate; trackId: string; soft: boolean }
  | { kind: "seed"; candidate: TrackingCandidate }
  | { kind: "intercept"; candidate: TrackingCandidate; trackId: string }
  | { kind: "skip"; candidate: TrackingCandidate; reason: string };

export type AssignStats = {
  links: number;
  softLinks: number;
  seeds: number;
  intercepts: number;
  skips: number;
  attentionConflicts: number;
};

export type ResolveOpts = {
  consumed: Set<string>;
  seedMin?: number;
  seedMaxFrontDistanceKm?: number;
  /** Веса географии seed (front-буст / interior-штраф / D0). */
  seedWeights?: SeedWeights;
  tieEpsilon?: number;
  maxConsecutiveSoft?: number;
  pauseFactor?: number;
  pauseFactorCap?: number;
};

/**
 * Разрешает assign для одной строки матрицы (Phase B decision tree).
 */
export function resolveRowAssignment(
  row: AttentionMatrixRow,
  kin: ProfileKinematics,
  opts: ResolveOpts,
): AssignDecision {
  const { candidate } = row;
  const seedMin = opts.seedMin ?? DEFAULT_SEED_MIN;
  const seedMaxFrontKm = opts.seedMaxFrontDistanceKm ?? DEFAULT_SEED_MAX_FRONT_DISTANCE_KM;
  const seedWeights = opts.seedWeights ?? DEFAULT_SEED_WEIGHTS;
  const tieEpsilon = opts.tieEpsilon ?? DEFAULT_TIE_EPSILON;

  if (shouldTerminateOnAttach(candidate.eventType)) {
    const winner = pickLinkWinner(row.links, tieEpsilon, candidate);
    if (winner) {
      return { kind: "intercept", candidate, trackId: winner.trackId };
    }
    return { kind: "skip", candidate, reason: "intercept_no_track" };
  }

  const winner = pickLinkWinner(row.links, tieEpsilon, candidate);

  if (winner?.inLocus) {
    return { kind: "link", candidate, trackId: winner.trackId, soft: false };
  }

  if (winner?.softEligible) {
    return { kind: "link", candidate, trackId: winner.trackId, soft: true };
  }

  if (canSeedCandidate(candidate, seedMin, seedMaxFrontKm, seedWeights)) {
    return { kind: "seed", candidate };
  }

  if (winner && !winner.inLocus) {
    return { kind: "skip", candidate, reason: "outside_locus_no_seed" };
  }

  return { kind: "skip", candidate, reason: "no_match" };
}

/** Выбирает winner по min linkCost с tie-break. */
function pickLinkWinner(
  links: AttentionMatrixRow["links"],
  tieEpsilon: number,
  candidate: TrackingCandidate,
) {
  if (links.length === 0) return null;

  const sorted = [...links].sort((a, b) => a.linkCost - b.linkCost);
  const best = sorted[0]!;

  const tied = sorted.filter(l => l.linkCost - best.linkCost <= tieEpsilon);
  if (tied.length <= 1) return best;

  // tie-break: clusterSize desc, then earlier point wins (stable)
  tied.sort((a, b) => {
    const csA = candidate.clusterSize ?? 1;
    const csB = candidate.clusterSize ?? 1;
    if (csB !== csA) return csB - csA;
    return a.dM2 - b.dM2;
  });

  return tied[0] ?? best;
}

/**
 * Полный batch resolve: matrix → decisions с учётом consumed.
 * Точки обрабатываются в порядке candidates (хронология).
 */
export function resolveAssignments(
  candidates: TrackingCandidate[],
  tracks: TrackAttentionTarget[],
  kin: ProfileKinematics,
  opts: ResolveOpts,
): { decisions: AssignDecision[]; stats: AssignStats } {
  const stats: AssignStats = {
    links: 0,
    softLinks: 0,
    seeds: 0,
    intercepts: 0,
    skips: 0,
    attentionConflicts: 0,
  };

  const decisions: AssignDecision[] = [];
  const consumed = opts.consumed;

  for (const candidate of candidates) {
    if (consumed.has(candidate.eventLocationId)) continue;

    const rows = buildAttentionMatrix([candidate], tracks, kin, {
      consumed,
      seedMin: opts.seedMin,
      seedWeights: opts.seedWeights,
      pauseFactor: opts.pauseFactor,
      pauseFactorCap: opts.pauseFactorCap,
    });
    const row = rows[0];
    if (!row) continue;

    const decision = resolveRowAssignment(row, kin, {
      consumed: opts.consumed,
      seedMin: opts.seedMin,
      seedMaxFrontDistanceKm: opts.seedMaxFrontDistanceKm,
      seedWeights: opts.seedWeights,
      tieEpsilon: opts.tieEpsilon,
      maxConsecutiveSoft: opts.maxConsecutiveSoft,
      pauseFactor: opts.pauseFactor,
      pauseFactorCap: opts.pauseFactorCap,
    });
    decisions.push(decision);

    switch (decision.kind) {
      case "link":
        consumed.add(candidate.eventLocationId);
        if (decision.soft) stats.softLinks++;
        else stats.links++;
        if (row.links.filter(l => Math.abs(l.linkCost - row.links[0]!.linkCost) <= (opts.tieEpsilon ?? DEFAULT_TIE_EPSILON)).length > 1) {
          stats.attentionConflicts++;
        }
        break;
      case "seed":
        consumed.add(candidate.eventLocationId);
        stats.seeds++;
        break;
      case "intercept":
        consumed.add(candidate.eventLocationId);
        stats.intercepts++;
        break;
      case "skip":
        stats.skips++;
        break;
    }
  }

  return { decisions, stats };
}
