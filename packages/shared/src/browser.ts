/**
 * Browser entry для Vite (@radar/shared).
 * Не использовать главный src/index.ts — тянет node:crypto.
 */
export * from "./schemas/index";

export {
  CRITICAL_WINDOW_MS,
  THREAT_MAP_STATUS_CODES,
  isCriticalTopBarThreat,
  isThreatMapStatusCode,
  isWithinCriticalWindow,
  resolveThreatVisual,
  resolveThreatVisualKey,
  shouldShowRegionThreatMarker,
} from "./visual/threat-visual";

export type {
  ResolveThreatVisualInput,
  ThreatMapStatusCode,
  ThreatTraits,
  ThreatVisual,
  ThreatVisualKey,
} from "./visual/threat-visual";

export {
  PROFILE_KINEMATICS,
  resolveProfileKinematics,
} from "./domain/tracking/profileKinematics";

export { observationCovarianceMeters } from "./domain/tracking/observationCovariance";

export {
  DEFAULT_SEED_MIN,
  DEFAULT_SEED_MAX_FRONT_DISTANCE_KM,
  DEFAULT_SEED_WEIGHTS,
} from "./domain/tracking/pointWeightModel";
export type { SeedWeights } from "./domain/tracking/pointWeightModel";
export { DEFAULT_FLOW_ALIGNMENT } from "./domain/tracking/flowAlignment";
export type { FlowAlignmentWeights } from "./domain/tracking/flowAlignment";
export {
  DEFAULT_MAGNETIZE_WEIGHTS,
} from "./domain/tracking/stdbscan/stdbscanMagnetize";
export {
  DEFAULT_MAGNET_COST_WEIGHTS,
} from "./domain/tracking/applyMagnetWeights";
export {
  maneuverToleranceM,
  sinCoefficientRho,
  inManeuverLocus,
  sigmaPosFromObservation,
} from "./domain/tracking/maneuverLocus";
export {
  normalizedKalmanRho,
  inKalmanLocus,
  inKalmanSoftLocus,
  kalmanLocusEllipseRing,
  kalmanLocusDebugDtSeconds,
} from "./domain/tracking/kalmanLocus";
export type { KalmanLocusEllipseInput } from "./domain/tracking/kalmanLocus";
export { bearingDeg, resolveFlowBearingDeg } from "./domain/tracking/flowAlignment";
export { DEFAULT_TURN_PENALTY } from "./domain/tracking/nextgen/nextgenGravity";
