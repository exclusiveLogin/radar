/**
 * Barrel export tracking domain — SSOT для всех потребителей.
 */
export type {
  ThreatProfile,
  NodeMode,
  TrackStatus,
  KalmanStateJson,
  SourceRef,
  TrackingCandidate,
  TrajectoryNode,
  TrajectoryTrack,
  /** Доменные типы (Date) — отдельно от Zod API-контрактов. */
  TrajectoryNode as TrackingDomainNode,
  TrajectoryTrack as TrackingDomainTrack,
} from "./types";

export type { ProfileKinematics } from "./profileKinematics";
export { PROFILE_KINEMATICS, resolveProfileKinematics, maxEpsilonTemporalMs } from "./profileKinematics";

export { TRACKING_TARGET_EVENT_TYPES, trackingTargetEventTypesSqlIn } from "./trackingTargetEvents";
export { resolveThreatProfile } from "./threatProfile";
export { resolveNodeMode } from "./resolveNodeMode";
export { observationCovarianceMeters, scaleObservationCovariance } from "./observationCovariance";
export type { ObservationCovariance } from "./observationCovariance";
export { haversineDistanceM } from "./haversine";
export { isDistinctDuplicate } from "./isDistinctDuplicate";
export { innovationGate } from "./innovationGate";
export type { GateResult } from "./innovationGate";
export { kalmanStep, kalmanInitState } from "./kalmanStep";
export { buildTrackMetadata } from "./buildTrackMetadata";
export { scoreSeedCandidate, isNearAnyOpenTrack } from "./trackOriginPolicy";
export type { OpenTrackSummary } from "./trackOriginPolicy";
export { checkTrackTermination } from "./trackTerminationPolicy";
export type { TerminationReason } from "./trackTerminationPolicy";
export { stdbscanDedup } from "./stdbscan/stdbscanDedup";
export type { StdbscanDedupResult } from "./stdbscan/stdbscanDedup";
export { buildTrackEdges } from "./flow/buildTrackEdges";
export type { TrajectoryEdge } from "./flow/buildTrackEdges";
export { rollupSegmentCounts } from "./flow/rollupSegmentCounts";
export type { SegmentRollup } from "./flow/rollupSegmentCounts";
export { buildSegmentKey } from "./flow/segmentKey";
export { filterEdgesByAsOf, filterNodesByAsOf } from "./flow/applyAsOfFilter";
