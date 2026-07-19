/**
 * ---
 * layer: shared
 * kind: domain-policy
 * domain: tracking
 * purpose: Детерминированный event-time порядок и граница переигрывания позднего события.
 * ---
 */
import type { TrackingWatermark } from "../../schemas/admin/tracking";
import type { TrackingCandidate, ThreatProfile } from "./types";
import { resolveProfileKinematics } from "./profileKinematics";

export type TrackingTemporalReplay = {
  /** Начало переигрываемого temporal tail. */
  since: Date;
  /** Поздние точки, из-за которых нужен replay. */
  lateEventIds: readonly string[];
};

/**
 * Единственный порядок обработки: event time, затем стабильный id.
 * Wake и размер батча не участвуют в принятии tracking-решения.
 */
export function orderTrackingCandidates(candidates: readonly TrackingCandidate[]): TrackingCandidate[] {
  return [...candidates].sort(compareTrackingCandidates);
}

/**
 * Находит поздние события относительно watermark и определяет temporal tail.
 * Lookback покрывает максимальную историю одного трека и dependency gap из доменной кинематики.
 */
export function resolveTrackingTemporalReplay(
  candidates: readonly TrackingCandidate[],
  watermark: TrackingWatermark | Record<string, never>,
  profiles?: Parameters<typeof resolveProfileKinematics>[1],
): TrackingTemporalReplay | null {
  if (!isTrackingWatermark(watermark)) return null;

  const late = orderTrackingCandidates(candidates).filter(candidate =>
    compareCandidateToWatermark(candidate, watermark) < 0,
  );
  if (late.length === 0) return null;

  const earliestLate = late[0]!;
  return {
    since: new Date(earliestLate.occurredAt.getTime() - trackingReplayLookbackMs(profiles)),
    lateEventIds: late.map(candidate => candidate.eventLocationId),
  };
}

/** Максимальная причинно значимая история определяется профилями, а не размером batch. */
export function trackingReplayLookbackMs(
  profiles?: Parameters<typeof resolveProfileKinematics>[1],
): number {
  const threatProfiles: ThreatProfile[] = ["uav", "rocket", "balloon", "unknown"];
  return Math.max(
    ...threatProfiles.map(profile => {
      const kinematics = resolveProfileKinematics(profile, profiles);
      return kinematics.maxTrackDurationMs + kinematics.maxGapMs + kinematics.stdbscanEpsilonTemporalMs;
    }),
  );
}

function compareTrackingCandidates(a: TrackingCandidate, b: TrackingCandidate): number {
  return a.occurredAt.getTime() - b.occurredAt.getTime()
    || compareEventLocationIds(a.eventLocationId, b.eventLocationId);
}

function compareCandidateToWatermark(candidate: TrackingCandidate, watermark: TrackingWatermark): number {
  return candidate.occurredAt.getTime() - new Date(watermark.lastOccurredAt).getTime()
    || compareEventLocationIds(candidate.eventLocationId, watermark.lastEventLocationId);
}

function compareEventLocationIds(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function isTrackingWatermark(value: TrackingWatermark | Record<string, never>): value is TrackingWatermark {
  return "lastOccurredAt" in value && "lastEventLocationId" in value;
}
