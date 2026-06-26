/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: Hard gates eligibility — geo, exclude types, attention pipeline.
 * ---
 */
import { TRACKING_PIPELINE_TYPES } from "./trackingTargetEvents";
import type { TrackingCandidate } from "./types";

const PIPELINE_SET = new Set<string>(TRACKING_PIPELINE_TYPES);

/** Точка имеет координаты — обязательное условие pipeline. */
export function hasGeo(candidate: Pick<TrackingCandidate, "lat" | "lon">): boolean {
  return candidate.lat != null && candidate.lon != null;
}

/** event_type входит в узкий pipeline-список. */
export function isPipelineEventType(eventType: string): boolean {
  return PIPELINE_SET.has(eventType);
}

/** Может участвовать в attention matrix / assign. */
export function canEnterAttention(candidate: TrackingCandidate): boolean {
  return hasGeo(candidate) && isPipelineEventType(candidate.eventType);
}

/** Может загружаться из БД (SQL + доменный guard). */
export function canEnterPipeline(candidate: TrackingCandidate): boolean {
  return canEnterAttention(candidate);
}
