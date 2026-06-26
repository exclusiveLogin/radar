/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: Unsupervised fitness для авто-тюнинга assign-параметров.
 * ---
 */
import type { AssignStats } from "./assignCandidates";

export type FitnessWeights = {
  w1: number;
  w2: number;
  w3: number;
  w4: number;
  w5: number;
  w6: number;
};

export const DEFAULT_FITNESS_WEIGHTS: FitnessWeights = {
  w1: 1.0,
  w2: 0.5,
  w3: 0.8,
  w4: 1.2,
  w5: 1.5,
  w6: 1.0,
};

export type FitnessInput = {
  totalPoints: number;
  /** Длины ФИНАЛИЗИРОВАННЫХ цепочек (>=2 ноды). Одиночные сиды цепочками не считаются. */
  trackLengths: number[];
  /** Средняя нормированная дистанция принятых линков [0..1] — proxy contamination. */
  meanAcceptDM: number;
  orphanCount: number;
  assignStats?: AssignStats;
};

/** Длина цепочки, при которой награда за среднюю длину насыщается. */
export const TARGET_CHAIN_LEN = 5;

export type FitnessResult = {
  fitness: number;
  coverage: number;
  meanTrackLenNorm: number;
  fragmentation: number;
  contamination: number;
  degeneracy: number;
  orphanRate: number;
  entropy: number;
  trackCount: number;
};

/** Shannon entropy по распределению длин треков. */
export function trackLengthEntropy(lengths: number[]): number {
  if (lengths.length === 0) return 0;
  const total = lengths.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let h = 0;
  for (const len of lengths) {
    const p = len / total;
    if (p > 0) h -= p * Math.log2(p);
  }
  return h;
}

/**
 * Композитная fitness с anti-degeneracy штрафами.
 */
export function computeTrackingFitness(
  input: FitnessInput,
  weights: FitnessWeights = DEFAULT_FITNESS_WEIGHTS,
): FitnessResult {
  const { totalPoints, meanAcceptDM, orphanCount } = input;
  const n = Math.max(totalPoints, 1);

  // Цепочками считаем только треки >=2 нод — одиночные сиды не покрытие.
  const chains = input.trackLengths.filter(l => l >= 2);
  const inTracks = chains.reduce((a, b) => a + b, 0);
  const coverage = inTracks / n;
  const orphanRate = orphanCount / n;

  const trackCount = chains.length;
  const meanLen = trackCount > 0 ? inTracks / trackCount : 0;
  // Насыщающая награда за длину цепи (а не деление на n, где сигнал ~0).
  const meanTrackLenNorm = Math.min(1, meanLen / TARGET_CHAIN_LEN);

  const shortTracks = chains.filter(l => l <= 3).length;
  const fragmentation = trackCount > 0 ? shortTracks / trackCount : 0;

  const maxLen = trackCount > 0 ? Math.max(...chains) : 0;
  const degeneracy = inTracks > 0 ? maxLen / inTracks : 0;

  const contamination = meanAcceptDM;
  const entropy = trackLengthEntropy(chains);

  const fitness =
    weights.w1 * coverage +
    weights.w2 * meanTrackLenNorm +
    0.1 * entropy -
    weights.w3 * fragmentation -
    weights.w4 * contamination -
    weights.w5 * degeneracy -
    weights.w6 * orphanRate;

  return {
    fitness,
    coverage,
    meanTrackLenNorm,
    fragmentation,
    contamination,
    degeneracy,
    orphanRate,
    entropy,
    trackCount,
  };
}
