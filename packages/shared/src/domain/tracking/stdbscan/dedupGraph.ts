/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking/stdbscan
 * purpose: Candidate window + post-cluster consumed — ST-DBSCAN на окне
 *          (pending + consumed-якоря). Размер daemon-тика не влияет на схлопывание.
 * ---
 */
import type { TrackingCandidate } from "../types";

/** Результат загрузки candidate window для инкрементального rebuild. */
export type CandidateWindowLoad = {
  /** Необработанные pipeline-точки (идут в assign + consumed). */
  pending: TrackingCandidate[];
  /**
   * Окно для ST-DBSCAN: pending ∪ недавние consumed в lookback ε_temporal.
   * Якоря не назначаются повторно.
   */
  window: TrackingCandidate[];
  lookbackMs: number;
};

/**
 * После глобального stdbscanDedup — в Kalman только новые pending winners.
 * Дубль, схлопнутый в уже consumed якорь, отфильтровывается.
 */
export function pickAssignableFromDedup(
  deduplicated: TrackingCandidate[],
  pendingIds: ReadonlySet<string>,
): TrackingCandidate[] {
  return deduplicated.filter(c => pendingIds.has(c.eventLocationId));
}

/**
 * Кого пометить consumed после тика с учётом режима кластеризации.
 * Magnet + reuse: только chunk; collapse / magnet без reuse: chunk + non-winners.
 */
export function resolvePendingConsumedAfterClustering(
  fullPendingIds: ReadonlySet<string>,
  chunkIds: ReadonlySet<string>,
  winnerIds: ReadonlySet<string>,
  clusteringMode: "collapse" | "magnet" = "collapse",
  reuseAcrossTracks = false,
): string[] {
  const consumed: string[] = [];
  for (const id of fullPendingIds) {
    if (clusteringMode === "magnet" && reuseAcrossTracks) {
      if (chunkIds.has(id)) consumed.push(id);
      continue;
    }
    if (chunkIds.has(id) || !winnerIds.has(id)) consumed.push(id);
  }
  return consumed;
}

/** @deprecated Используйте resolvePendingConsumedAfterClustering. */
export function resolvePendingConsumedAfterDedup(
  fullPendingIds: ReadonlySet<string>,
  chunkIds: ReadonlySet<string>,
  dedupWinnerIds: ReadonlySet<string>,
): string[] {
  return resolvePendingConsumedAfterClustering(fullPendingIds, chunkIds, dedupWinnerIds, "collapse", false);
}

/** Уникальные кандидаты по eventLocationId (pending перекрывает anchor). */
export function mergeCandidateWindow(
  pending: TrackingCandidate[],
  anchors: TrackingCandidate[],
): TrackingCandidate[] {
  const byId = new Map<string, TrackingCandidate>();
  for (const a of anchors) {
    byId.set(a.eventLocationId, a);
  }
  for (const p of pending) {
    byId.set(p.eventLocationId, p);
  }
  return [...byId.values()].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );
}
