/**
 * SSOT: типы событий для tracking pipeline (узкий список phase-1c).
 */
export const TRACKING_PIPELINE_TYPES = [
  "fixation",
  "danger",
  "warning",
  "mass_warning",
  "pvo_work",
  "pvo_report",
  "intercept",
] as const;

export type TrackingPipelineEventType = (typeof TRACKING_PIPELINE_TYPES)[number];

/** @deprecated alias — используй TRACKING_PIPELINE_TYPES */
export const TRACKING_TARGET_EVENT_TYPES = TRACKING_PIPELINE_TYPES;

/** SQL-литерал для IN (...) — только доверенные коды из константы. */
export function trackingPipelineTypesSqlIn(): string {
  return TRACKING_PIPELINE_TYPES.map(c => `'${c}'`).join(", ");
}

/** @deprecated alias */
export function trackingTargetEventTypesSqlIn(): string {
  return trackingPipelineTypesSqlIn();
}
