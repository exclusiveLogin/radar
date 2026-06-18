import type { ParsedEvent } from "@radar/shared";

/** Оценка остроты по маркерам в тексте и типу события (SSOT для parsePost и workspace). */
export function inferSeverity(
  raw: string,
  eventType: string,
): ParsedEvent["severity"] {
  if (eventType === "cleared") return "info";
  if (eventType === "rocket_threat") return "critical";
  if (/сбит|реактив/i.test(raw)) return "critical";
  if (/опасност|тревог/i.test(raw)) return "danger";
  if (/внимани/i.test(raw)) return "attention";
  return "info";
}
