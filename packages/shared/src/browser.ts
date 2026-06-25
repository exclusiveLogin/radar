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
