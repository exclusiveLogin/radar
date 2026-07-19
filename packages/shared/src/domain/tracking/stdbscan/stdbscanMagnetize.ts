/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking/stdbscan
 * purpose: ST-DBSCAN магнитная фаза — без collapse, вес магнетизма на каждую точку.
 *          Winner = argmax(seedScore); clusterMass = Σ seedScore облака.
 * ---
 */
import { computeSeedScore, DEFAULT_SEED_WEIGHTS, type SeedWeights } from "../pointWeightModel";
import type { PlaceGravityIndex } from "../flow/placeGravityIndex";
import { EMPTY_PLACE_GRAVITY_INDEX } from "../flow/placeGravityIndex";
import type { TrackingCandidate } from "../types";
import {
  findStdbscanNeighbors,
  type StdbscanClusterParams,
} from "./stdbscanNeighbors";

export type MagnetismEntry = {
  clusterId: number;
  /** Итоговый магнетизм (3 слоя свёрнуты). */
  magnetism: number;
  isWinner: boolean;
  clusterMass: number;
  seedScore: number;
};

export type MagnetizeWeights = {
  lambdaCloud: number;
  lambdaHist: number;
  useHistoricalGravity: boolean;
  geohashPrecision: number;
  seedWeights?: SeedWeights;
};

export const DEFAULT_MAGNETIZE_WEIGHTS: MagnetizeWeights = {
  lambdaCloud: 0.5,
  lambdaHist: 0.3,
  useHistoricalGravity: false,
  geohashPrecision: 5,
};

export type StdbscanMagnetizeResult = {
  /** Все кандидаты (без схлопывания), с clusterSize. */
  candidates: TrackingCandidate[];
  magnetism: Map<string, MagnetismEntry>;
  /** Число кластеров (не noise). */
  clusterCount: number;
};

export type { StdbscanClusterParams as ClusterParams } from "./stdbscanNeighbors";

const UNASSIGNED = -1;
const NOISE = 0;

/**
 * ST-DBSCAN → магнетизм без удаления точек.
 * При reuseAcrossTracks=OFF потребитель фильтрует только winner'ов для assign.
 */
export function stdbscanMagnetize(
  candidates: TrackingCandidate[],
  params: StdbscanClusterParams,
  weights: MagnetizeWeights = DEFAULT_MAGNETIZE_WEIGHTS,
  gravityIndex: PlaceGravityIndex = EMPTY_PLACE_GRAVITY_INDEX,
): StdbscanMagnetizeResult {
  const n = candidates.length;
  const magnetism = new Map<string, MagnetismEntry>();
  if (n === 0) return { candidates: [], magnetism, clusterCount: 0 };

  const seedWeights = weights.seedWeights ?? DEFAULT_SEED_WEIGHTS;
  const labels = runDbscanLabels(candidates, params);

  const clusters = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const label = labels[i]!;
    if (label === NOISE) continue;
    if (!clusters.has(label)) clusters.set(label, []);
    clusters.get(label)!.push(i);
  }

  const enriched: TrackingCandidate[] = candidates.map(c => ({ ...c }));

  for (let i = 0; i < n; i++) {
    const label = labels[i]!;
    if (label === NOISE) {
      const seedScore = computeSeedScore(candidates[i]!, seedWeights);
      const histBonus = historicalBonus(candidates[i]!, seedScore, weights, gravityIndex);
      const m = seedScore * histBonus;
      enriched[i] = { ...enriched[i]!, clusterSize: 1 };
      magnetism.set(candidates[i]!.eventLocationId, {
        clusterId: NOISE,
        magnetism: m,
        isWinner: true,
        clusterMass: seedScore,
        seedScore,
      });
    }
  }

  for (const [clusterId, indices] of clusters) {
    const clusterMass = indices.reduce(
      (sum, i) => sum + computeSeedScore(candidates[i]!, seedWeights),
      0,
    );
    const winnerIdx = selectWinnerBySeedScore(candidates, indices, seedWeights);
    const winner = candidates[winnerIdx]!;

    for (const i of indices) {
      const c = candidates[i]!;
      const seedScore = computeSeedScore(c, seedWeights);
      const isWinner = i === winnerIdx;
      const cloudFactor = 1 + weights.lambdaCloud * clusterMass;
      const histBonus = isWinner
        ? historicalBonus(winner, seedScore, weights, gravityIndex)
        : historicalBonus(c, seedScore, weights, gravityIndex);
      const m = seedScore * cloudFactor * histBonus;

      enriched[i] = { ...enriched[i]!, clusterSize: indices.length };
      magnetism.set(c.eventLocationId, {
        clusterId,
        magnetism: m,
        isWinner,
        clusterMass,
        seedScore,
      });
    }
  }

  return { candidates: enriched, magnetism, clusterCount: clusters.size };
}

/** Только winner'ы и noise-одиночки — для assign при reuseAcrossTracks=OFF. */
export function pickMagnetWinnersForAssign(
  candidates: TrackingCandidate[],
  magnetism: Map<string, MagnetismEntry>,
): TrackingCandidate[] {
  return candidates.filter(c => magnetism.get(c.eventLocationId)?.isWinner ?? true);
}

function historicalBonus(
  candidate: TrackingCandidate,
  seedScore: number,
  weights: MagnetizeWeights,
  gravityIndex: PlaceGravityIndex,
): number {
  if (!weights.useHistoricalGravity) return 1;
  const entry = gravityIndex.lookupForCandidate(candidate, weights.geohashPrecision);
  if (!entry || entry.mass <= 0) return 1;
  return 1 + weights.lambdaHist * entry.mass;
}

function selectWinnerBySeedScore(
  candidates: TrackingCandidate[],
  indices: number[],
  seedWeights: SeedWeights,
): number {
  let bestIdx = indices[0]!;
  let bestScore = -Infinity;
  for (const i of indices) {
    const score = computeSeedScore(candidates[i]!, seedWeights);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function runDbscanLabels(
  candidates: TrackingCandidate[],
  params: StdbscanClusterParams,
): number[] {
  const n = candidates.length;
  const labels = new Array<number>(n).fill(UNASSIGNED);
  let clusterCount = 0;

  for (let i = 0; i < n; i++) {
    if (labels[i] !== UNASSIGNED) continue;
    const neighbors = findStdbscanNeighbors(candidates, i, params);
    if (neighbors.length < params.minPts - 1) {
      labels[i] = NOISE;
      continue;
    }
    clusterCount++;
    labels[i] = clusterCount;
    const seeds = [...neighbors];
    for (let si = 0; si < seeds.length; si++) {
      const j = seeds[si]!;
      if (labels[j] === NOISE) labels[j] = clusterCount;
      if (labels[j] !== UNASSIGNED) continue;
      labels[j] = clusterCount;
      const jNeighbors = findStdbscanNeighbors(candidates, j, params);
      if (jNeighbors.length >= params.minPts - 1) {
        for (const jn of jNeighbors) {
          if (!seeds.includes(jn)) seeds.push(jn);
        }
      }
    }
  }
  return labels;
}

