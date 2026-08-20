/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: Вычисление агрегатных метаданных трека после сборки нод:
 *          скорость, курс, статус (active/closed/stale).
 * ---
 */
import type { TrackStatus, TrajectoryNode } from "./types";
import type { ProfileKinematics } from "./profileKinematics";

type TrackMetadata = {
  status: TrackStatus;
  velocityMs: number | null;
  bearingDeg: number | null;
  lastLat: number;
  lastLon: number;
  lastAt: Date;
  firstAt: Date;
  nodeCount: number;
};

/**
 * Вычисляет метаданные трека по набору нод.
 *
 * Статус:
 * - active: последняя кинематическая нода в пределах staleAfterMs от rebuildAt
 * - stale: последние ноды все attach_only (нет кинематики в хвосте)
 * - closed: последняя кинематическая была, но давно (> staleAfterMs)
 */
export function buildTrackMetadata(
  nodes: TrajectoryNode[],
  profile: ProfileKinematics,
  rebuildAt: Date = new Date(),
): TrackMetadata {
  if (nodes.length === 0) {
    throw new Error("buildTrackMetadata: nodes cannot be empty");
  }

  const firstNode = nodes[0];
  const lastNode = nodes[nodes.length - 1];

  const lastKinematicNode = [...nodes].reverse().find(n => n.mode === "correct");
  const lastKalmanState = lastKinematicNode?.kalmanState ?? null;

  const velocityMs = lastKalmanState
    ? Math.sqrt(lastKalmanState.vx ** 2 + lastKalmanState.vy ** 2)
    : null;

  const bearingDeg = lastKalmanState && (Math.abs(lastKalmanState.vx) > 0.01 || Math.abs(lastKalmanState.vy) > 0.01)
    ? (Math.atan2(lastKalmanState.vx, lastKalmanState.vy) * 180) / Math.PI
    : null;

  const status = resolveStatus(lastKinematicNode, profile, rebuildAt);

  return {
    status,
    velocityMs,
    bearingDeg,
    lastLat: lastNode.lat,
    lastLon: lastNode.lon,
    lastAt: lastNode.occurredAt,
    firstAt: firstNode.occurredAt,
    nodeCount: nodes.length,
  };
}

function resolveStatus(
  lastKinematic: TrajectoryNode | undefined,
  profile: ProfileKinematics,
  rebuildAt: Date,
): TrackStatus {
  if (!lastKinematic) return "stale";
  const silenceMs = rebuildAt.getTime() - lastKinematic.occurredAt.getTime();
  return silenceMs <= profile.staleAfterMs ? "active" : "closed";
}
