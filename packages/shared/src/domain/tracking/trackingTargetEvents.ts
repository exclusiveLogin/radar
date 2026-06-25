/**
 * SSOT: целевые типы событий для трекинга (фиксации, угрозы, ПВО).
 * Не включает шум вроде cleared/stale без гео-смысла для трека.
 */
export const TRACKING_TARGET_EVENT_TYPES = [
  "fixation",
  "rocket_threat",
  "airspace_restriction",
  "danger",
  "warning",
  "mass_warning",
  "intercept",
  "pvo_work",
  "pvo_report",
] as const;

/** SQL-литерал для IN (...) — только доверенные коды из константы выше. */
export function trackingTargetEventTypesSqlIn(): string {
  return TRACKING_TARGET_EVENT_TYPES.map(c => `'${c}'`).join(", ");
}
