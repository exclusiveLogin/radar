import type { EventType } from "@radar/shared";

/** GeoPolicy v1: какие типы требуют гео-якорь (из RFC). */
const STRICT_TYPES = new Set<EventType>([
  "fixation",
  "attention",
  "danger",
  "pvo_work",
  "intercept",
  "impact",
  "rocket_threat",
  "warning",
]);

const REGION_ONLY_TYPES = new Set<EventType>(["cleared", "warning"]);

/** Проверка: кандидат проходит geo policy перед materialize. */
export function isCandidateGeoValid(input: {
  eventType: string;
  anchorKind: "place" | "region" | "system";
  /** Канальный отбой «по всем …» — system-якорь без перечня регионов. */
  massClearChannel?: boolean;
}): boolean {
  const type = input.eventType as EventType;
  if (REGION_ONLY_TYPES.has(type)) {
    if (input.massClearChannel && input.anchorKind === "system") {
      return true;
    }
    return input.anchorKind === "region" || input.anchorKind === "place";
  }
  if (STRICT_TYPES.has(type)) {
    return input.anchorKind === "place" || input.anchorKind === "region";
  }
  return true;
}

/**
 * ADR-027: тупой порог materialize по extras.geoScore.
 * Нет score / gate выключен → пропускаем (heal/legacy/audit).
 */
export function isCandidateGeoScoreAcceptable(input: {
  extras: Record<string, unknown>;
  gateEnabled: boolean;
  threshold: number;
}): boolean {
  if (!input.gateEnabled) return true;
  const score = input.extras.geoScore;
  if (typeof score !== "number" || Number.isNaN(score)) return true;
  return score >= input.threshold;
}
