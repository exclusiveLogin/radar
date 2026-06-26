/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: Политика автозавершения трека по лимитам профиля и intercept.
 * ---
 */
import type { ProfileKinematics } from "./profileKinematics";

export type TerminationReason = "max_duration" | "max_range" | "intercept" | null;

type TerminationCheckInput = {
  firstAt: Date;
  currentAt: Date;
  totalDistanceM: number;
  profile: ProfileKinematics;
  /** Принудительное закрытие после intercept attach. */
  forceIntercept?: boolean;
};

type TerminationResult = {
  shouldClose: boolean;
  reason: TerminationReason;
};

/** Закрытие трека по intercept-событию. */
export function terminateByIntercept(): TerminationResult {
  return { shouldClose: true, reason: "intercept" };
}

/**
 * Проверяет, должен ли трек быть закрыт по физическим лимитам профиля.
 */
export function checkTrackTermination(input: TerminationCheckInput): TerminationResult {
  if (input.forceIntercept) {
    return terminateByIntercept();
  }

  const { firstAt, currentAt, totalDistanceM, profile } = input;
  const lifetimeMs = currentAt.getTime() - firstAt.getTime();

  if (lifetimeMs > profile.maxTrackDurationMs) {
    return { shouldClose: true, reason: "max_duration" };
  }

  if (totalDistanceM > profile.maxRangeFromOriginM) {
    return { shouldClose: true, reason: "max_range" };
  }

  return { shouldClose: false, reason: null };
}
