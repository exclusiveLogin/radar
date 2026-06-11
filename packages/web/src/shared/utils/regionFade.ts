/**
 * Затухание яркости заливки региона со временем.
 *
 * Сразу после события (now − statusEventAt ≈ 0) → коэффициент 1.0 (полная яркость).
 * Через 3 часа и позже → FADE_MIN (тёмный тон сохраняется до сброса состояния).
 * Между 0 и 3ч — линейная интерполяция.
 */

const FADE_DURATION_MS = 3 * 60 * 60 * 1000;

/** Минимальный коэффициент яркости (20% от базового) — держится до смены статуса. */
export const REGION_FADE_MIN = 0.2;

/**
 * Возвращает коэффициент яркости заливки [REGION_FADE_MIN..1.0].
 * Если statusEventAt не задан — сразу возвращает минимум.
 *
 * @param statusEventAt - ISO-строка момента события (из MapRegionSnapshot)
 * @param now - текущее время в ms (Date.now())
 */
export function regionFadeFactor(
  statusEventAt: string | undefined,
  now: number,
): number {
  if (!statusEventAt) return REGION_FADE_MIN;
  const elapsed = now - new Date(statusEventAt).getTime();
  if (elapsed <= 0) return 1.0;
  if (elapsed >= FADE_DURATION_MS) return REGION_FADE_MIN;
  return 1.0 - (elapsed / FADE_DURATION_MS) * (1.0 - REGION_FADE_MIN);
}

/** Базовая непрозрачность слоя × коэффициент затухания по statusEventAt. */
export function fadedLayerOpacity(
  statusEventAt: string | undefined,
  now: number,
  baseOpacity: number,
): number {
  return baseOpacity * regionFadeFactor(statusEventAt, now);
}

/** Заливка region/place на гео — regionFadeFactor × fillScale (схема: fillScale=1). */
export function geoMapFillOpacity(
  statusEventAt: string | undefined,
  now: number,
  fillScale = 1,
): number {
  return regionFadeFactor(statusEventAt, now) * fillScale;
}

/**
 * Контур: минимум +50% к заливке (strokeFillRatio), но не выше 1.0.
 */
export function geoMapStrokeOpacity(
  statusEventAt: string | undefined,
  now: number,
  fillScale = 1,
  strokeFillRatio = 1.5,
): number {
  return Math.min(1, geoMapFillOpacity(statusEventAt, now, fillScale) * strokeFillRatio);
}
