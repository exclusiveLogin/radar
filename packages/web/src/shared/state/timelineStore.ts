import { BehaviorSubject } from "rxjs";
import {
  clearHistoricalView,
  historicalAsOf$,
  registerBeforeHistoricalSet,
  setHistoricalAsOf,
} from "./mapStore";

/** Масштаб окна таймлайна. */
export type TimelineScale = "24h" | "7d" | "30d";

export const TIMELINE_SCALE_MS: Record<TimelineScale, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export const TIMELINE_SCALES: TimelineScale[] = ["24h", "7d", "30d"];

/** Дискретные шаги ползунка. */
export const TIMELINE_SLIDER_STEPS = 1000;

/** Текущий масштаб окна. */
export const timelineScale$ = new BehaviorSubject<TimelineScale>("24h");

/** null = правая граница «сейчас» (live right edge). */
export const timelineAnchorEnd$ = new BehaviorSubject<string | null>(null);

/** Конец окна в ms: anchor или now. */
export function resolveTimelineWindowEnd(nowMs: number): number {
  const anchor = timelineAnchorEnd$.value;
  if (!anchor) return nowMs;
  const ms = Date.parse(anchor);
  return Number.isFinite(ms) ? ms : nowMs;
}

/** Начало окна по масштабу и концу. */
export function resolveTimelineWindowStart(
  endMs: number,
  scale: TimelineScale = timelineScale$.value,
): number {
  return endMs - TIMELINE_SCALE_MS[scale];
}

/** ISO конца календарного дня в MSK (23:59:59.999). */
export function endOfDayMskIso(dateInput: string): string {
  const [y, m, d] = dateInput.split("-").map(Number);
  if (!y || !m || !d) return new Date().toISOString();

  const utcMs = Date.UTC(y, m - 1, d, 20, 59, 59, 999);
  return new Date(utcMs).toISOString();
}

/** Сегодня в MSK как YYYY-MM-DD для input[type=date]. */
export function todayMskDateInput(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts;
}

/** ISO из позиции ползунка: 0 — начало окна, max — конец. */
export function isoFromSliderStep(
  step: number,
  windowStartMs: number,
  windowEndMs: number,
): string {
  const ratio = step / TIMELINE_SLIDER_STEPS;
  const ms = windowStartMs + ratio * (windowEndMs - windowStartMs);
  return new Date(ms).toISOString();
}

/** Позиция ползунка из ISO маркера asOf. */
export function sliderStepFromIso(
  iso: string,
  windowStartMs: number,
  windowEndMs: number,
): number {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return TIMELINE_SLIDER_STEPS;
  const span = windowEndMs - windowStartMs;
  if (span <= 0) return TIMELINE_SLIDER_STEPS;
  const ratio = (ms - windowStartMs) / span;
  return Math.min(TIMELINE_SLIDER_STEPS, Math.max(0, Math.round(ratio * TIMELINE_SLIDER_STEPS)));
}

/** Clamp ISO в границы окна. */
export function clampIsoToWindow(iso: string, windowStartMs: number, windowEndMs: number): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return new Date(windowEndMs).toISOString();
  const clamped = Math.min(windowEndMs, Math.max(windowStartMs, ms));
  return new Date(clamped).toISOString();
}

/** Минимальный scale, чтобы targetMs попал в окно [end − scale, end]. */
export function minimalScaleForTarget(targetMs: number, endMs: number): TimelineScale {
  for (const scale of TIMELINE_SCALES) {
    const startMs = endMs - TIMELINE_SCALE_MS[scale];
    if (targetMs >= startMs && targetMs <= endMs) return scale;
  }
  return "30d";
}

/** Подогнать окно под jump из ленты (postedAt вне текущего окна). */
export function fitTimelineWindowForJump(iso: string, nowMs: number = Date.now()): void {
  const targetMs = Date.parse(iso);
  if (!Number.isFinite(targetMs)) return;

  const currentEnd = resolveTimelineWindowEnd(nowMs);
  const currentStart = resolveTimelineWindowStart(currentEnd);
  if (targetMs >= currentStart && targetMs <= currentEnd) return;

  const dayInput = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(targetMs));

  const isToday = dayInput === todayMskDateInput();
  const endMs = isToday ? nowMs : Date.parse(endOfDayMskIso(dayInput));
  const scale = minimalScaleForTarget(targetMs, endMs);

  timelineScale$.next(scale);

  if (!isToday && endMs < nowMs - 60_000) {
    timelineAnchorEnd$.next(endOfDayMskIso(dayInput));
  } else {
    timelineAnchorEnd$.next(null);
  }
}

function clampHistoricalToWindow(nowMs: number): void {
  const asOf = historicalAsOf$.value;
  if (!asOf) return;
  const endMs = resolveTimelineWindowEnd(nowMs);
  const startMs = resolveTimelineWindowStart(endMs);
  const clamped = clampIsoToWindow(asOf, startMs, endMs);
  if (clamped !== asOf) setHistoricalAsOf(clamped);
}

export function setTimelineScale(scale: TimelineScale): void {
  if (scale === timelineScale$.value) return;
  timelineScale$.next(scale);
  clampHistoricalToWindow(Date.now());
}

export function setTimelineAnchorEnd(iso: string | null): void {
  if (iso === timelineAnchorEnd$.value) return;
  timelineAnchorEnd$.next(iso);
  clampHistoricalToWindow(Date.now());
}

/** Live: сброс replay и календарного anchor. */
export function returnTimelineToLive(): void {
  timelineAnchorEnd$.next(null);
  clearHistoricalView();
}

/** true если нужна кнопка Live (replay или anchor в прошлом). */
export function isTimelineLiveButtonVisible(nowMs: number = Date.now()): boolean {
  if (historicalAsOf$.value !== null) return true;
  const anchor = timelineAnchorEnd$.value;
  if (!anchor) return false;
  const anchorMs = Date.parse(anchor);
  return Number.isFinite(anchorMs) && anchorMs < nowMs - 60_000;
}

registerBeforeHistoricalSet(fitTimelineWindowForJump);
