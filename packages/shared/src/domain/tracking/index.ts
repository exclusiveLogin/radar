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
  DEFAULT_SEED_MIN,
  REGION_COEFF_FRONT,
  REGION_COEFF_INTERIOR_RF,
  REGION_COEFF_DEFAULT,
  FRONT_PROXIMITY_D0_KM,
} from "./pointWeightModel";

export { hasGeo, isPipelineEventType, canEnterAttention, canEnterPipeline } from "./trackingEligibility";

export { invert2x2, mahalanobis2 } from "./mat2";
export type { Mat2 } from "./mat2";

export { predictKalmanState, innovationCovariance, latLonToMeters } from "./predictKalmanState";
export type { PredictResult } from "./predictKalmanState";

export { scoreInnovation, computeTimeDecay } from "./innovationScore";
export type { InnovationScore, InnovationScoreInput } from "./innovationScore";

export { buildAttentionMatrix } from "./attentionMatrix";
export type { TrackAttentionTarget, LinkCell, AttentionMatrixRow } from "./attentionMatrix";

export {
  resolveRowAssignment,
  resolveAssignments,
  DEFAULT_TIE_EPSILON,
  DEFAULT_MAX_CONSECUTIVE_SOFT,
} from "./assignCandidates";
export type { AssignDecision, AssignStats, ResolveOpts } from "./assignCandidates";

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
export { buildTrackEdges } from "./flow/buildTrackEdges";
export type { TrajectoryEdge } from "./flow/buildTrackEdges";
export { rollupSegmentCounts } from "./flow/rollupSegmentCounts";
export type { SegmentRollup } from "./flow/rollupSegmentCounts";
export { buildSegmentKey } from "./flow/segmentKey";
export { filterEdgesByAsOf, filterNodesByAsOf } from "./flow/applyAsOfFilter";

export { computeTrackingFitness } from "./trackingFitness";
export type { FitnessInput, FitnessResult, FitnessWeights } from "./trackingFitness";

export { patternSearchStep, defaultTuneAxes, probeCenter, patternMove, tuneCenterFromProfile, tuneCenterToProfilePatch } from "./configSampler";
export type { TuneAxis, TuneCenter, PatternSearchState } from "./configSampler";

export {
  resolveTrackingPipelineStatus,
} from "./resolvePipelineStatus";
export type {
  TrackingPipelineStatusCode,
  TrackingPipelineStatusView,
  ResolvePipelineStatusInput,
} from "./resolvePipelineStatus";

export { TRACKING_PIPELINE_NOT_PROCESSED_SQL } from "./pipelineProcessedSql";
