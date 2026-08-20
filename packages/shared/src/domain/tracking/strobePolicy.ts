/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: Детерминированный event-time strobe: фиксированная сетка бинов floor(t/window).
 * ---
 */
import type { TrackingCandidate } from "./types";

/** Максимальная длина event-time окна (и шаг сетки бинов). */
export const DEFAULT_TRACKING_STROBE_MAX_WINDOW_MS = 20 * 60 * 1000;

export type TrackingStrobeConfig = {
  maxWindowMs: number;
};

export type TrackingStrobeBounds = {
  firstOccurredAt: Date;
  closesAt: Date;
};

/**
 * Бин зависит только от event-time точки: binStart = floor(t / W) * W.
 * Порядок обработки не влияет на идентичность strobe.
 * Полуинтервал [binStart, closesAt): точка на границе принадлежит следующему бину.
 */
export function createTrackingStrobeBounds(
  occurredAt: Date,
  config: TrackingStrobeConfig,
): TrackingStrobeBounds {
  const windowMs = config.maxWindowMs;
  const binStartMs = Math.floor(occurredAt.getTime() / windowMs) * windowMs;
  return {
    firstOccurredAt: new Date(binStartMs),
    closesAt: new Date(binStartMs + windowMs),
  };
}

/** Точка принадлежит strobe в полуинтервале [first, closes). */
export function belongsToTrackingStrobe(
  candidate: Pick<TrackingCandidate, "occurredAt">,
  bounds: TrackingStrobeBounds,
): boolean {
  const t = candidate.occurredAt.getTime();
  return t >= bounds.firstOccurredAt.getTime() && t < bounds.closesAt.getTime();
}

/** Strobe готов к финализации, когда frontier достиг или прошёл closesAt. */
export function isTrackingStrobeReady(
  bounds: TrackingStrobeBounds,
  frontier: Date,
): boolean {
  return frontier.getTime() >= bounds.closesAt.getTime();
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
