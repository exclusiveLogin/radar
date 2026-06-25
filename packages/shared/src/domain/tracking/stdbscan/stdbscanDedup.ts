/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: ST-DBSCAN precision-aware dedup — схлопывание кластеров почти
 *          одновременных наблюдений об одном событии из разных каналов.
 *
 *          Из кластера выбирается ОДИН winner (argmin sigma),
 *          остальные точки сливаются в winner.sourceRefs.
 *          Это предотвращает перешумление ковариации Kalman грубыми наблюдениями.
 *
 *          Noise-точки (не попавшие ни в один кластер) идут в Kalman как есть.
 * ---
 */
import { haversineDistanceM } from "../haversine";
import { observationCovarianceMeters } from "../observationCovariance";
import type { TrackingCandidate } from "../types";

export type StdbscanDedupResult = {
  /** Дедуплицированные кандидаты (winners + noise), отсортированы по occurredAt. */
  deduplicated: TrackingCandidate[];
  /** Число схлопнутых точек (не вошедших в финальный набор). */
  collapsedCount: number;
};

type ClusterParams = {
  epsilonSpatialM: number;
  epsilonTemporalMs: number;
  minPts: number;
};

const UNASSIGNED = -1;
const NOISE = 0;

/**
 * Запускает ST-DBSCAN dedup на батче кандидатов.
 *
 * Алгоритм:
 * 1. DBSCAN по пространственно-временной близости
 * 2. Из каждого кластера → winner = argmin(observationSigma)
 * 3. Остальные точки кластера → merged в winner.sourceRefs
 * 4. Noise → остаются без изменений
 */
export function stdbscanDedup(
  candidates: TrackingCandidate[],
  params: ClusterParams,
): StdbscanDedupResult {
  const n = candidates.length;
  if (n === 0) return { deduplicated: [], collapsedCount: 0 };

  const labels = new Array<number>(n).fill(UNASSIGNED);
  let clusterCount = 0;

  for (let i = 0; i < n; i++) {
    if (labels[i] !== UNASSIGNED) continue;

    const neighbors = getNeighbors(candidates, i, params);

    // Стандартный DBSCAN: minPts включает саму точку → нужно minPts-1 соседей
    if (neighbors.length < params.minPts - 1) {
      labels[i] = NOISE;
      continue;
    }

    clusterCount++;
    labels[i] = clusterCount;

    const seeds = [...neighbors];
    for (let si = 0; si < seeds.length; si++) {
      const j = seeds[si];
      if (labels[j] === NOISE) labels[j] = clusterCount;
      if (labels[j] !== UNASSIGNED) continue;

      labels[j] = clusterCount;
      const jNeighbors = getNeighbors(candidates, j, params);
      if (jNeighbors.length >= params.minPts - 1) {
        for (const jn of jNeighbors) {
          if (!seeds.includes(jn)) seeds.push(jn);
        }
      }
    }
  }

  // Группируем по кластерам
  const clusters = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const label = labels[i];
    if (label === NOISE) continue;
    if (!clusters.has(label)) clusters.set(label, []);
    clusters.get(label)!.push(i);
  }

  const result: TrackingCandidate[] = [];
  let collapsedCount = 0;

  // Для каждого кластера — выбираем winner
  for (const [, indices] of clusters) {
    const winner = selectWinner(candidates, indices);
    const mergedRefs = indices
      .filter(i => candidates[i] !== winner)
      .flatMap(i => candidates[i].sourceRefs);

    collapsedCount += mergedRefs.length;

    result.push({
      ...winner,
      sourceRefs: [...winner.sourceRefs, ...mergedRefs],
    });
  }

  // Добавляем noise-точки без изменений
  for (let i = 0; i < n; i++) {
    if (labels[i] === NOISE) result.push(candidates[i]);
  }

  // Сортируем по времени для Kalman
  result.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  return { deduplicated: result, collapsedCount };
}

/** Возвращает индексы кандидатов в ε-окрестности точки i. */
function getNeighbors(
  candidates: TrackingCandidate[],
  i: number,
  params: ClusterParams,
): number[] {
  const ci = candidates[i];
  const neighbors: number[] = [];

  for (let j = 0; j < candidates.length; j++) {
    if (i === j) continue;
    const cj = candidates[j];

    const dtMs = Math.abs(ci.occurredAt.getTime() - cj.occurredAt.getTime());
    if (dtMs > params.epsilonTemporalMs) continue;

    const dist = haversineDistanceM(ci.lat, ci.lon, cj.lat, cj.lon);
    if (dist <= params.epsilonSpatialM) neighbors.push(j);
  }

  return neighbors;
}

/** Выбирает наиточнейшую точку кластера (argmin sigma). */
function selectWinner(
  candidates: TrackingCandidate[],
  indices: number[],
): TrackingCandidate {
  let bestIdx = indices[0];
  let bestSigma = Infinity;

  for (const i of indices) {
    const c = candidates[i];
    const { sigmaLatM } = observationCovarianceMeters(c.precision, c.trust);
    if (sigmaLatM < bestSigma) {
      bestSigma = sigmaLatM;
      bestIdx = i;
    }
  }

  return candidates[bestIdx];
}
