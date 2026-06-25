/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking/flow
 * purpose: Агрегация P2P-рёбер в rollup-сегменты с весом (count/weight).
 *          Общий сегмент A→B из разных треков накапливает вес —
 *          основа для визуализации flow-коридоров (толщина ∝ weight).
 * ---
 */
import { buildSegmentKey } from "./segmentKey";
import type { TrajectoryEdge } from "./buildTrackEdges";
import type { ThreatProfile } from "../types";

/** Агрегированный сегмент с накопленным весом. */
export type SegmentRollup = {
  fromPlaceKey: string;
  toPlaceKey: string;
  threatProfile: ThreatProfile;
  count: number;
  /** v1: weight = count; v2: count × recency_factor. */
  weight: number;
  lastSeenAt: Date;
  /** Репрезентативные координаты (усреднение первых наблюдений). */
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
};

type RollupOptions = {
  /** Минимальное число наблюдений сегмента для включения в результат. */
  minCount?: number;
  /** Если true — разбивать по threatProfile. По умолчанию false (суммарно). */
  splitByProfile?: boolean;
};

/**
 * Агрегирует рёбра треков в rollup-сегменты.
 *
 * Ключ: (fromPlaceKey, toPlaceKey[, threatProfile]).
 * weight v1 = count (простой подсчёт).
 */
export function rollupSegmentCounts(
  edges: TrajectoryEdge[],
  options: RollupOptions = {},
): SegmentRollup[] {
  const { minCount = 1, splitByProfile = false } = options;

  const map = new Map<
    string,
    { rollup: SegmentRollup; count: number }
  >();

  for (const edge of edges) {
    const profile = splitByProfile ? edge.threatProfile : ("all" as ThreatProfile);
    const key = buildSegmentKey(edge.fromPlaceKey, edge.toPlaceKey, splitByProfile ? profile : undefined);

    if (!map.has(key)) {
      map.set(key, {
        count: 0,
        rollup: {
          fromPlaceKey: edge.fromPlaceKey,
          toPlaceKey: edge.toPlaceKey,
          threatProfile: edge.threatProfile,
          count: 0,
          weight: 0,
          lastSeenAt: edge.occurredAt,
          fromLat: edge.fromLat,
          fromLon: edge.fromLon,
          toLat: edge.toLat,
          toLon: edge.toLon,
        },
      });
    }

    const entry = map.get(key)!;
    entry.count += 1;
    if (edge.occurredAt > entry.rollup.lastSeenAt) {
      entry.rollup.lastSeenAt = edge.occurredAt;
    }
  }

  const result: SegmentRollup[] = [];
  for (const { count, rollup } of map.values()) {
    if (count < minCount) continue;
    result.push({ ...rollup, count, weight: count });
  }

  return result.sort((a, b) => b.weight - a.weight);
}
