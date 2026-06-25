/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: Политика автозавершения трека по лимитам профиля модели.
 *          Три независимые оси завершения:
 *          1. maxTrackDurationMs — физический lifetime
 *          2. maxRangeFromOriginM — радиус действия
 *          3. maxGapMs / staleAfterMs — обрабатывается в buildTrackMetadata
 * ---
 */
import type { ProfileKinematics } from "./profileKinematics";

export type TerminationReason = "max_duration" | "max_range" | null;

type TerminationCheckInput = {
  firstAt: Date;
  currentAt: Date;
  /** Накопленная дальность от origin (м). */
  totalDistanceM: number;
  profile: ProfileKinematics;
};

type TerminationResult = {
  shouldClose: boolean;
  reason: TerminationReason;
};

/**
 * Проверяет, должен ли трек быть закрыт по физическим лимитам профиля.
 * Вызывается после каждого добавления ноды.
 */
export function checkTrackTermination(
  input: TerminationCheckInput,
): TerminationResult {
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
