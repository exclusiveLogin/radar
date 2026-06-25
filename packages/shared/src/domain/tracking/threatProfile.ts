/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: Определение профиля угрозы по типу/субъекту события.
 *          SSOT маппинга event → ThreatProfile для Kalman + L2 rollup.
 * ---
 */
import type { ThreatProfile } from "./types";

/** Входные данные для разрешения профиля. */
type ThreatProfileInput = {
  eventType: string;
  eventSubject?: string | null;
  eventCategory?: string | null;
  extras?: Record<string, unknown>;
};

/** Коды субъектов → профиль угрозы. */
const SUBJECT_TO_PROFILE: Record<string, ThreatProfile> = {
  rocket: "rocket",
  drone: "uav",
  mws: "balloon",
  aviation: "uav",
};

/** Коды типов событий, явно относящихся к ракетной угрозе. */
const ROCKET_EVENT_TYPES = new Set([
  "rocket_threat",
  "airspace_restriction",
]);

/**
 * Разрешает профиль угрозы из доменного события.
 *
 * Приоритет: eventSubject > eventType keywords > default uav.
 * Fallback: unknown только если невозможно определить ничего.
 */
export function resolveThreatProfile(input: ThreatProfileInput): ThreatProfile {
  if (input.eventSubject) {
    const fromSubject = SUBJECT_TO_PROFILE[input.eventSubject];
    if (fromSubject) return fromSubject;
  }

  if (ROCKET_EVENT_TYPES.has(input.eventType)) return "rocket";

  const lowerType = input.eventType.toLowerCase();
  if (lowerType.includes("rocket") || lowerType.includes("missile")) return "rocket";
  if (lowerType.includes("balloon") || lowerType.includes("mws")) return "balloon";

  return "uav";
}
