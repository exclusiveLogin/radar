/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking/flow
 * purpose: Фильтрация рёбер/нод по курсору времени asOf (Time Machine).
 *          SSOT для read-side проекции L2 с учётом historicalAsOf.
 * ---
 */
import type { TrajectoryEdge } from "./buildTrackEdges";
import type { TrajectoryNode } from "../types";

/**
 * Фильтрует рёбра по asOf: ребро включается, если его occurredAt ≤ asOf.
 */
export function filterEdgesByAsOf(
  edges: TrajectoryEdge[],
  asOf: Date,
): TrajectoryEdge[] {
  return edges.filter(e => e.occurredAt <= asOf);
}

/**
 * Фильтрует ноды трека по asOf.
 */
export function filterNodesByAsOf(
  nodes: TrajectoryNode[],
  asOf: Date,
): TrajectoryNode[] {
  return nodes.filter(n => n.occurredAt <= asOf);
}
