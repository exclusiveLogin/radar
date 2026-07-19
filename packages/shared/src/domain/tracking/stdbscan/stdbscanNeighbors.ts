/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking/stdbscan
 * purpose: Пространственно-временная ε-окрестность кандидата для всех фаз ST-DBSCAN.
 * ---
 */
import { haversineDistanceM } from "../haversine";
import type { TrackingCandidate } from "../types";

/** Параметры пространственно-временной окрестности ST-DBSCAN. */
export type StdbscanClusterParams = {
  epsilonSpatialM: number;
  epsilonTemporalMs: number;
  minPts: number;
};

/** Возвращает индексы кандидатов в ε-окрестности точки i. */
export function findStdbscanNeighbors(
  candidates: TrackingCandidate[],
  i: number,
  params: StdbscanClusterParams,
): number[] {
  const candidate = candidates[i]!;
  const neighbors: number[] = [];

  for (let j = 0; j < candidates.length; j++) {
    if (i === j) continue;

    const neighbor = candidates[j]!;
    const timeDistanceMs = Math.abs(
      candidate.occurredAt.getTime() - neighbor.occurredAt.getTime(),
    );
    if (timeDistanceMs > params.epsilonTemporalMs) continue;

    const spatialDistanceM = haversineDistanceM(
      candidate.lat,
      candidate.lon,
      neighbor.lat,
      neighbor.lon,
    );
    if (spatialDistanceM <= params.epsilonSpatialM) neighbors.push(j);
  }

  return neighbors;
}
