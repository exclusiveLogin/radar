/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking/flow
 * purpose: Извлечение направленных P2P-рёбер из нод трека для L2 rollup.
 *          Ребро строится между соседними нодами, имеющими place_id или H3-key.
 *          Ноды без пространственного ключа пропускаются.
 * ---
 */
import type { ThreatProfile, TrajectoryNode } from "../types";

/** Направленное ребро между двумя местами / H3-ячейками. */
export type TrajectoryEdge = {
  trackId: string;
  fromNodeId: string;
  toNodeId: string;
  /** place_id или H3-ключ (fallback при coverage < 40%). */
  fromPlaceKey: string;
  toPlaceKey: string;
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
  threatProfile: ThreatProfile;
  /** Время второй ноды — для asOf-фильтрации в Time Machine. */
  occurredAt: Date;
};

type BuildEdgesOptions = {
  /** Fallback-функция: lat/lon → H3-ключ. Если null — нода без place_id пропускается. */
  latLonToH3Key?: (lat: number, lon: number) => string | null;
};

/**
 * Строит направленные рёбра из цепочки нод одного трека.
 *
 * Ребро создаётся только если обе соседние ноды имеют пространственный ключ
 * (place_id или H3 fallback) и они разные (нет self-loop).
 */
export function buildTrackEdges(
  nodes: TrajectoryNode[],
  trackId: string,
  threatProfile: ThreatProfile,
  options: BuildEdgesOptions = {},
): TrajectoryEdge[] {
  const edges: TrajectoryEdge[] = [];

  for (let i = 0; i < nodes.length - 1; i++) {
    const from = nodes[i];
    const to = nodes[i + 1];

    const fromKey = resolvePlaceKey(from, options.latLonToH3Key);
    const toKey = resolvePlaceKey(to, options.latLonToH3Key);

    if (!fromKey || !toKey) continue;
    if (fromKey === toKey) continue; // skip self-loop

    edges.push({
      trackId,
      fromNodeId: from.id,
      toNodeId: to.id,
      fromPlaceKey: fromKey,
      toPlaceKey: toKey,
      fromLat: from.lat,
      fromLon: from.lon,
      toLat: to.lat,
      toLon: to.lon,
      threatProfile,
      occurredAt: to.occurredAt,
    });
  }

  return edges;
}

function resolvePlaceKey(
  node: TrajectoryNode,
  latLonToH3Key?: (lat: number, lon: number) => string | null,
): string | null {
  if (node.placeId) return node.placeId;
  if (latLonToH3Key) return latLonToH3Key(node.lat, node.lon);
  return null;
}
