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
import {
  evaluateNextGenLinkWithReason,
  type NextGenLinkRejectReason,
  type NextGenSeedTrack,
} from "../nextgenKalmanLink";
import type { TurnPenaltyConfig } from "../nextgenGravity";
import type { NodeMode, ThreatProfile, TrajectoryTrack } from "../../types";
import type { NextGenNode } from "../step1-stdbscan/NextGenStep1";
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

export interface NextGenStep3Stats {
  linksConsidered: number;
  linksAccepted: number;
  nodesSeeded: number;
  rejectGap: number;
  rejectDistance: number;
  rejectVelocity: number;
  rejectCounterFlow: number;
  rejectTurn: number;
  rejectKalmanInnovation: number;
}

export class NextGenStep3 {
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
  ): { tracks: TrajectoryTrack[]; stats: NextGenStep3Stats } {
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
    const stats: NextGenStep3Stats = {
      linksConsidered: 0,
      linksAccepted: 0,
      nodesSeeded: 0,
      rejectGap: 0,
      rejectDistance: 0,
      rejectVelocity: 0,
      rejectCounterFlow: 0,
      rejectTurn: 0,
      rejectKalmanInnovation: 0,
    };
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
        const decision = evaluateNextGenLinkWithReason(
          { ...ctx, nearestFrontLat: node.nearestFrontLat, nearestFrontLon: node.nearestFrontLon },
          node,
          kin,
          flowMap,
          weights,
          incomingBearing,
          turn,
        );
        stats.linksConsidered += 1;
        if (!decision.link) {
          this.bumpReject(stats, decision.rejectReason);
          continue;
        }
        if (decision.link.cost < bestCost) {
          bestCost = decision.link.cost;
          bestTrack = track;
        }
      }

      if (bestTrack) {
        appendNodeToOpenTrack(bestTrack, node, kin);
        touchedTrackIds.add(bestTrack.trackId);
        stats.linksAccepted += 1;
      } else {
        const seeded = createOpenTrackFromNode(node, kin);
        openTracks.push(seeded);
        touchedTrackIds.add(seeded.trackId);
        stats.nodesSeeded += 1;
      }
      used.add(node.eventLocationId);
    }

    const rebuildAt = sorted[sorted.length - 1]?.occurredAt ?? new Date();

    return {
      tracks: openTracks
      .filter(t => t.nodes.length > 0 && touchedTrackIds.has(t.trackId))
      .map(t => toTrajectoryTrack(t, profile, kin, rebuildAt, minBackboneNodes)),
      stats,
    };
  }

  private static bumpReject(
    stats: NextGenStep3Stats,
    reason: NextGenLinkRejectReason | undefined,
  ): void {
    switch (reason) {
      case "gap":
        stats.rejectGap += 1;
        break;
      case "distance":
        stats.rejectDistance += 1;
        break;
      case "velocity":
        stats.rejectVelocity += 1;
        break;
      case "counter_flow":
        stats.rejectCounterFlow += 1;
        break;
      case "turn":
        stats.rejectTurn += 1;
        break;
      case "kalman_innovation":
        stats.rejectKalmanInnovation += 1;
        break;
      default:
        break;
    }
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
