/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking/nextgen
 * purpose: Kalman-шаг при добавлении ноды в open-трек Ф3 NextGen.
 * ---
 */
import { randomUUID } from "crypto";
import { haversineDistanceM } from "../haversine";
import { innovationGate } from "../innovationGate";
import { kalmanInitState, kalmanStep } from "../kalmanStep";
import {
  observationCovarianceMeters,
  scaleObservationCovariance,
} from "../observationCovariance";
import type { ProfileKinematics } from "../profileKinematics";
import type { KalmanStateJson, TrajectoryNode } from "../types";
import type { NextGenNode } from "./phase1-stdbscan/NextGenPhase1";
import type { NextGenSeedTrack } from "./nextgenKalmanLink";

/** Рабочее состояние open-трека внутри Ф3. */
export type NextGenOpenTrack = NextGenSeedTrack;

/** eventLocationId из sourceRefs или fallback на id ноды. */
export function eventIdFromNode(node: TrajectoryNode): string {
  return node.sourceRefs[0]?.eventLocationId ?? node.id;
}

/** TrackingCandidate-поля для хвоста (front может отсутствовать у persist-нутых нод). */
export function tailLinkContext(track: NextGenOpenTrack): {
  refLat: number;
  refLon: number;
  kalmanState: KalmanStateJson | null;
  lastAt: Date;
  lastLat: number;
  lastLon: number;
  nearestFrontLat: null;
  nearestFrontLon: null;
  nodes: readonly TrajectoryNode[];
} {
  const last = track.nodes[track.nodes.length - 1]!;
  return {
    refLat: track.refLat,
    refLon: track.refLon,
    kalmanState: last.kalmanState,
    lastAt: last.occurredAt,
    lastLat: last.lat,
    lastLon: last.lon,
    nearestFrontLat: null,
    nearestFrontLon: null,
    nodes: track.nodes,
  };
}

/** Новый open-трек из seed-ноды с инициализацией Kalman. */
export function createOpenTrackFromNode(
  node: NextGenNode,
  kin: ProfileKinematics,
): NextGenOpenTrack {
  const trackId = randomUUID();
  const R = scaleObservationCovariance(
    observationCovarianceMeters(node.precision, node.trust),
    kin.observationSigmaScale,
  );
  const kalmanState =
    node.mode === "correct"
      ? kalmanInitState(
          node.lat,
          node.lon,
          node.lat,
          node.lon,
          R.sigmaLatM,
          kin.initialVelocitySigmaMps,
        )
      : null;

  const trajectoryNode: TrajectoryNode = {
    id: randomUUID(),
    trackId,
    seq: 0,
    occurredAt: node.occurredAt,
    lat: node.lat,
    lon: node.lon,
    placeId: node.placeId,
    mode: node.mode,
    kalmanState,
    sourceRefs: node.sourceRefs,
  };

  return {
    trackId,
    nodes: [trajectoryNode],
    refLat: node.lat,
    refLon: node.lon,
    totalDistanceM: 0,
  };
}

/** Добавляет ноду к open-треку с Kalman correct (как appendNode в worker). */
export function appendNodeToOpenTrack(
  track: NextGenOpenTrack,
  node: NextGenNode,
  kin: ProfileKinematics,
): void {
  const lastNode = track.nodes[track.nodes.length - 1]!;
  const dtSeconds = (node.occurredAt.getTime() - lastNode.occurredAt.getTime()) / 1000;
  const R = scaleObservationCovariance(
    observationCovarianceMeters(node.precision, node.trust),
    kin.observationSigmaScale,
  );

  let kalmanState = lastNode.kalmanState;
  if (node.mode === "correct") {
    if (kalmanState) {
      const gate = innovationGate({
        state: kalmanState,
        observationLat: node.lat,
        observationLon: node.lon,
        observedAt: node.occurredAt,
        R,
        refLat: track.refLat,
        refLon: track.refLon,
        maxVelocityMs: kin.maxVelocityMs,
        chi2Threshold: kin.chi2Threshold,
        rearThresholdM: kin.rearThresholdM,
        processNoiseScale: kin.processNoiseScale,
        dtSeconds,
      });
      if (gate.accept) {
        kalmanState = kalmanStep(
          kalmanState,
          node.lat,
          node.lon,
          dtSeconds,
          R,
          kin.processNoiseScale,
          track.refLat,
          track.refLon,
        );
      }
    } else {
      kalmanState = kalmanInitState(
        node.lat,
        node.lon,
        track.refLat,
        track.refLon,
        R.sigmaLatM,
        kin.initialVelocitySigmaMps,
      );
    }
  }

  track.totalDistanceM += haversineDistanceM(
    lastNode.lat,
    lastNode.lon,
    node.lat,
    node.lon,
  );

  track.nodes.push({
    id: randomUUID(),
    trackId: track.trackId,
    seq: track.nodes.length,
    occurredAt: node.occurredAt,
    lat: node.lat,
    lon: node.lon,
    placeId: node.placeId,
    mode: node.mode,
    kalmanState,
    sourceRefs: node.sourceRefs,
  });
}
