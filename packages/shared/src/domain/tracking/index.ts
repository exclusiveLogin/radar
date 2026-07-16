/**
 * Barrel export tracking domain — SSOT для всех потребителей.
 */
export type {
  ThreatProfile,
  NodeMode,
  TrackStatus,
  MutationState,
  KalmanStateJson,
  SourceRef,
  TrackingCandidate,
  TrajectoryNode,
  TrajectoryTrack,
  TrajectoryNode as TrackingDomainNode,
  TrajectoryTrack as TrackingDomainTrack,
} from "./types";

export type { ProfileKinematics } from "./profileKinematics";
export { PROFILE_KINEMATICS, resolveProfileKinematics, maxEpsilonTemporalMs } from "./profileKinematics";

export {
  TRACKING_PIPELINE_TYPES,
  TRACKING_TARGET_EVENT_TYPES,
  trackingPipelineTypesSqlIn,
  trackingTargetEventTypesSqlIn,
} from "./trackingTargetEvents";
export type { TrackingPipelineEventType } from "./trackingTargetEvents";

export { EVENT_TYPE_COEFFICIENTS, getEventTypeCoeffs, canSeedByEventType, shouldTerminateOnAttach } from "./eventTypeCoefficients";
export type { EventTypeCoeffs } from "./eventTypeCoefficients";

export {
  computeGeoCoeff,
  computeRegionCoeff,
  computeFrontProximityCoeff,
  computeSeedScore,
  passesSeedThreshold,
  canSeedCandidate,
  DEFAULT_SEED_MIN,
  DEFAULT_SEED_MAX_FRONT_DISTANCE_KM,
  DEFAULT_SEED_WEIGHTS,
  REGION_COEFF_FRONT,
  REGION_COEFF_INTERIOR_RF,
  REGION_COEFF_DEFAULT,
  FRONT_PROXIMITY_D0_KM,
} from "./pointWeightModel";
export type { SeedWeights } from "./pointWeightModel";

export { hasGeo, isPipelineEventType, canEnterAttention, canEnterPipeline } from "./trackingEligibility";

export { invert2x2, mahalanobis2 } from "./mat2";
export type { Mat2 } from "./mat2";

export { predictKalmanState, innovationCovariance, latLonToMeters } from "./predictKalmanState";
export type { PredictResult } from "./predictKalmanState";

export { scoreInnovation, computeTimeDecay } from "./innovationScore";
export type { InnovationScore, InnovationScoreInput } from "./innovationScore";

export { isRearOfVelocity, segmentVelocityMps } from "./rearFrontGate";

export {
  maneuverToleranceM,
  sinCoefficientRho,
  inManeuverLocus,
  sigmaPosFromObservation,
} from "./maneuverLocus";
export {
  normalizedKalmanRho,
  inKalmanLocus,
  inKalmanSoftLocus,
  kalmanLocusEllipseRing,
  kalmanLocusDebugDtSeconds,
} from "./kalmanLocus";
export type { KalmanLocusEllipseInput } from "./kalmanLocus";

export {
  bearingDeg,
  flowAlignmentCos,
  isCounterFlowRejected,
  resolveFlowBearingDeg,
  applyFlowAlignment,
  DEFAULT_FLOW_ALIGNMENT,
} from "./flowAlignment";
export type { FlowAlignmentWeights } from "./flowAlignment";

export { resolveThreatProfile } from "./threatProfile";
export { resolveNodeMode } from "./resolveNodeMode";
export { observationCovarianceMeters, scaleObservationCovariance } from "./observationCovariance";
export type { ObservationCovariance } from "./observationCovariance";
export { haversineDistanceM } from "./haversine";
export { isDistinctDuplicate } from "./isDistinctDuplicate";
export { innovationGate, DEFAULT_CHI2_THRESHOLD, LEGACY_REAR_THRESHOLD_M } from "./innovationGate";
export type { GateResult } from "./innovationGate";
export { kalmanStep, kalmanInitState } from "./kalmanStep";
export { buildTrackMetadata } from "./buildTrackMetadata";
export { scoreSeedCandidate, isNearAnyOpenTrack } from "./trackOriginPolicy";
export type { OpenTrackSummary } from "./trackOriginPolicy";
export { checkTrackTermination, terminateByIntercept } from "./trackTerminationPolicy";
export type { TerminationReason } from "./trackTerminationPolicy";
export { stdbscanDedup } from "./stdbscan/stdbscanDedup";
export type { StdbscanDedupResult } from "./stdbscan/stdbscanDedup";
export {
  stdbscanMagnetize,
  pickMagnetWinnersForAssign,
  DEFAULT_MAGNETIZE_WEIGHTS,
} from "./stdbscan/stdbscanMagnetize";
export type { MagnetismEntry, MagnetizeWeights, StdbscanMagnetizeResult } from "./stdbscan/stdbscanMagnetize";
export {
  applyMagnetWeights,
  magnetismOf,
  DEFAULT_MAGNET_COST_WEIGHTS,
  EMPTY_MAGNETISM_INDEX,
} from "./applyMagnetWeights";
export type { MagnetCostWeights, MagnetismIndex } from "./applyMagnetWeights";
export { encodeGeohash, zoneKeyForCandidate } from "./flow/geohashZoneKey";
export {
  createPlaceGravityIndex,
  EMPTY_PLACE_GRAVITY_INDEX,
} from "./flow/placeGravityIndex";
export type { PlaceGravityEntry, PlaceGravityIndex } from "./flow/placeGravityIndex";
export { buildPlaceGravityIndexFromCandidates } from "./flow/buildPlaceGravityIndex";
export {
  runClusteringForProfile,
  mergeMagnetismIndexes,
  resolveMagnetCostWeights,
  resolvePlaceGravityForRebuild,
} from "./stdbscan/clusteringPhase";
export type { ClusteringPhaseResult } from "./stdbscan/clusteringPhase";
export {
  pickAssignableFromDedup,
  mergeCandidateWindow,
  resolvePendingConsumedAfterDedup,
  resolvePendingConsumedAfterClustering,
} from "./stdbscan/dedupGraph";
export type { CandidateWindowLoad } from "./stdbscan/dedupGraph";
export { buildTrackEdges } from "./flow/buildTrackEdges";
export type { TrajectoryEdge } from "./flow/buildTrackEdges";
export {
  createCorridorRollupIndex,
  corridorBearingDeg,
  EMPTY_CORRIDOR_ROLLUP_INDEX,
} from "./flow/corridorRollupIndex";
export type { CorridorRollupEntry, CorridorRollupIndex } from "./flow/corridorRollupIndex";

export { rollupSegmentCounts } from "./flow/rollupSegmentCounts";
export type { SegmentRollup } from "./flow/rollupSegmentCounts";
export { buildSegmentKey } from "./flow/segmentKey";
export { filterEdgesByAsOf, filterNodesByAsOf } from "./flow/applyAsOfFilter";

export {
  resolveTrackingPipelineStatus,
} from "./resolvePipelineStatus";
export type {
  TrackingPipelineStatusCode,
  TrackingPipelineStatusView,
  ResolvePipelineStatusInput,
} from "./resolvePipelineStatus";

export { TRACKING_PIPELINE_NOT_PROCESSED_SQL } from "./pipelineProcessedSql";
export {
  TRACKING_PERSIST_ADVISORY_LOCK_KEY,
  TRACKING_DAEMON_MAX_BATCH_SIZE,
  resolveDaemonBatchSize,
  NEXTGEN_RECOMMENDED_BATCH_SIZE,
  TRACKING_RESET_TRUNCATE_SQL,
  withTrackingL1Transaction,
  withTrackingL1ReadRetry,
  isPgDeadlockError,
  isPgLockNotAvailableError,
  type TrackingPgQueryFn,
  type TrackingL1TransactionRunner,
} from "./trackingDbLock";
export * from "./nextgen/index";