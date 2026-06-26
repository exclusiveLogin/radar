/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: Определение режима участия ноды в треке (ADR-008).
 *          correct — участвует в Kalman.correct(); attach_only — нет.
 * ---
 */
import type { NodeMode } from "./types";

/** Категории событий, не влияющих на кинематику. */
const ATTACH_ONLY_CATEGORIES = new Set([
  "report",
  "pvo_report",
  "pvo_stats",
  "static",
]);

/** Типы событий, всегда attach_only вне зависимости от остального. */
const ATTACH_ONLY_EVENT_TYPES = new Set([
  "pvo_report",
  "pvo_work",
  "intercept",
  "safety_measures",
  "cleared",
]);

type NodeModeInput = {
  eventType: string;
  eventCategory: string | null;
  /** Из status_dictionary.affects_kinematics; null — неизвестно, применяем fallback. */
  affectsKinematics: boolean | null;
  lat: number | null;
  lon: number | null;
};

/**
 * Определяет режим ноды для Kalman-пайплайна.
 *
 * Приоритет:
 * 1. affectsKinematics из status_dictionary (явная разметка) — наивысший.
 * 2. Категория события → attach_only если в denylist.
 * 3. Тип события → attach_only если в denylist.
 * 4. Нет координат → attach_only (нечего корректировать).
 * 5. Default → correct.
 */
export function resolveNodeMode(input: NodeModeInput): NodeMode {
  if (input.lat == null || input.lon == null) return "attach_only";

  if (input.affectsKinematics === false) return "attach_only";
  if (input.affectsKinematics === true) return "correct";

  if (input.eventCategory && ATTACH_ONLY_CATEGORIES.has(input.eventCategory)) {
    return "attach_only";
  }

  if (ATTACH_ONLY_EVENT_TYPES.has(input.eventType)) return "attach_only";

  return "correct";
}
