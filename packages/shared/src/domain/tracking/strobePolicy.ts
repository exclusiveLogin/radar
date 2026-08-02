/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: Детерминированный event-time strobe для накопления дублей одного инцидента.
 * ---
 */
import type { TrackingCandidate } from "./types";

/** Максимальная длина event-time окна от первой точки strobe. */
export const DEFAULT_TRACKING_STROBE_MAX_WINDOW_MS = 20 * 60 * 1000;

export type TrackingStrobeConfig = {
  maxWindowMs: number;
};

export type TrackingStrobeBounds = {
  firstOccurredAt: Date;
  closesAt: Date;
};

/**
 * Граница strobe зависит только от первой event-time точки.
 * Поздние точки не расширяют окно и не меняют его идентичность.
 */
export function createTrackingStrobeBounds(
  firstOccurredAt: Date,
  config: TrackingStrobeConfig,
): TrackingStrobeBounds {
  return {
    firstOccurredAt,
    closesAt: new Date(firstOccurredAt.getTime() + config.maxWindowMs),
  };
}

/** Точка принадлежит strobe, пока не вышла за фиксированную event-time границу. */
export function belongsToTrackingStrobe(
  candidate: Pick<TrackingCandidate, "occurredAt">,
  bounds: TrackingStrobeBounds,
): boolean {
  return candidate.occurredAt.getTime() <= bounds.closesAt.getTime();
}

/** Strobe можно финализировать по event-time frontier либо по wall-clock таймеру. */
export function isTrackingStrobeReady(
  bounds: TrackingStrobeBounds,
  frontier: Date,
): boolean {
  return frontier.getTime() > bounds.closesAt.getTime();
}

/**
 * Стабильный выбор winner внутри закрытого geo-time кластера.
 * Precision/trust переводятся в sigma уровнем кластеризатора; здесь сохраняется
 * детерминированный fallback, чтобы порядок страницы не менял итог.
 */
export function compareTrackingCandidates(
  left: Pick<TrackingCandidate, "occurredAt" | "eventLocationId">,
  right: Pick<TrackingCandidate, "occurredAt" | "eventLocationId">,
): number {
  return left.occurredAt.getTime() - right.occurredAt.getTime()
    || left.eventLocationId.localeCompare(right.eventLocationId);
}
