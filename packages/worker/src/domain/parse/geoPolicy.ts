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
