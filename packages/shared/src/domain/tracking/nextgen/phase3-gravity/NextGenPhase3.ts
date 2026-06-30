/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking/nextgen
 * purpose: Фаза 3 — joining по Kalman-локусу + H3-гравитации (хронологический argmin).
 * ---
 */
import { bearingDeg } from "../../flowAlignment";
import { haversineDistanceM } from "../../haversine";
import type { ProfileKinematics } from "../../profileKinematics";
import type { FlowAlignmentWeights } from "../../flowAlignment";
import type { H3VectorFlowMap } from "../flow-map/H3VectorFlowMap";
import { evaluateNextGenLink, type NextGenSeedTrack } from "../nextgenKalmanLink";
import type { TurnPenaltyConfig } from "../nextgenGravity";
import type { NodeMode, ThreatProfile, TrajectoryTrack } from "../../types";
import type { NextGenNode } from "../phase1-stdbscan/NextGenPhase1";
import {
  appendNodeToOpenTrack,
  createOpenTrackFromNode,
  eventIdFromNode,
  tailLinkContext,
  type NextGenOpenTrack,
} from "../nextgenTrackStep";
import { buildTrackMetadata } from "../../buildTrackMetadata";

/** Минимум нод для сплошной магистрали (иначе пунктир). */
const DEFAULT_MIN_BACKBONE_NODES = 3;

export class NextGenPhase3 {
  /**
   * Forward pass: ноды батча по времени → лучший open-трек (min evaluateNextGenLink) или seed.
   * seedTracks — хвосты из БД (incremental/live).
   */
  public static assemble(
    nodes: readonly NextGenNode[],
    kin: ProfileKinematics,
    flowMap: H3VectorFlowMap,
    weights: FlowAlignmentWeights,
    turn: TurnPenaltyConfig,
    profile: ThreatProfile,
    minBackboneNodes: number = DEFAULT_MIN_BACKBONE_NODES,
    seedTracks: readonly NextGenSeedTrack[] = [],
  ): TrajectoryTrack[] {
    const sorted = [...nodes].sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
    );

    const openTracks: NextGenOpenTrack[] = seedTracks.map(s => ({
      trackId: s.trackId,
      nodes: [...s.nodes],
      refLat: s.refLat,
      refLon: s.refLon,
      totalDistanceM: s.totalDistanceM,
    }));

    const used = new Set<string>();
    /** Треки, изменённые в этом прогоне — только их отдаём наружу (не весь open pool из БД). */
    const touchedTrackIds = new Set<string>();
    for (const track of openTracks) {
      for (const n of track.nodes) used.add(eventIdFromNode(n));
    }

    for (const node of sorted) {
      if (used.has(node.eventLocationId)) continue;

      let bestTrack: NextGenOpenTrack | null = null;
      let bestCost = Number.POSITIVE_INFINITY;

      for (const track of openTracks) {
        const tail = track.nodes[track.nodes.length - 1]!;
        const gapMs = node.occurredAt.getTime() - tail.occurredAt.getTime();
        if (gapMs <= 0 || gapMs > kin.maxGapMs) continue;

        // Дешёвый gate до Kalman/H3 — иначе O(nodes × openTracks) взрывается.
        if (haversineDistanceM(tail.lat, tail.lon, node.lat, node.lon) > kin.maxLinkDistanceM) {
          continue;
        }

        const prev = track.nodes.length >= 2 ? track.nodes[track.nodes.length - 2]! : null;
        const incomingBearing = prev
          ? bearingDeg(prev.lat, prev.lon, tail.lat, tail.lon)
          : null;

        const ctx = tailLinkContext(track);
        const link = evaluateNextGenLink(
          { ...ctx, nearestFrontLat: node.nearestFrontLat, nearestFrontLon: node.nearestFrontLon },
          node,
          kin,
          flowMap,
          weights,
          incomingBearing,
          turn,
        );
        if (link && link.cost < bestCost) {
          bestCost = link.cost;
          bestTrack = track;
        }
      }

      if (bestTrack) {
        appendNodeToOpenTrack(bestTrack, node, kin);
        touchedTrackIds.add(bestTrack.trackId);
      } else {
        const seeded = createOpenTrackFromNode(node, kin);
        openTracks.push(seeded);
        touchedTrackIds.add(seeded.trackId);
      }
      used.add(node.eventLocationId);
    }

    const rebuildAt = sorted[sorted.length - 1]?.occurredAt ?? new Date();

    return openTracks
      .filter(t => t.nodes.length > 0 && touchedTrackIds.has(t.trackId))
      .map(t => toTrajectoryTrack(t, profile, kin, rebuildAt, minBackboneNodes));
  }
}

function toTrajectoryTrack(
  track: NextGenOpenTrack,
  profile: ThreatProfile,
  kin: ProfileKinematics,
  rebuildAt: Date,
  minBackboneNodes: number,
): TrajectoryTrack {
  const mode: NodeMode =
    track.nodes.length >= minBackboneNodes ? "correct" : "segment_only";
  const nodesWithMode = track.nodes.map(n => ({ ...n, mode }));
  const meta = buildTrackMetadata(nodesWithMode, kin, rebuildAt);

  return {
    id: track.trackId,
    status: meta.status,
    threatProfile: profile,
    firstAt: meta.firstAt,
    lastAt: meta.lastAt,
    lastLat: meta.lastLat,
    lastLon: meta.lastLon,
    velocityMs: meta.velocityMs,
    bearingDeg: meta.bearingDeg,
    nodeCount: meta.nodeCount,
    totalDistanceM: track.totalDistanceM,
    nodes: nodesWithMode,
  };
}
