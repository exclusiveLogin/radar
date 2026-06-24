/**
 * Мост LLM-категории события (`eventCategory`) к коду словаря статусов
 * (ADR-003, Фаза E). Словарь — SSOT: предпочтительный код применяется только если
 * он есть и активен; иначе берём представителя целевого `state_level`.
 */
import type { GeoEventCategory, StateLevel, StatusDictionaryRecord } from "@radar/shared";

/** Целевой уровень состояния для каждой LLM-категории. */
export const EVENT_CATEGORY_LEVEL: Record<GeoEventCategory, StateLevel | null> = {
  all_clear: "green",
  cleared: "green",
  impact: "red",
  intercept: "red",
  fixation: "red",
  movement: "red",
  danger: "red",
  warning: "red",
  threat: "orange",
  rocket_threat: "red",
  attention: "yellow",
  pvo_work: "yellow",
  noise: null,
  other: null,
};

/** Предпочтительный код словаря (валидируется по фактическому словарю). */
const CATEGORY_PREFERRED_CODE: Record<GeoEventCategory, string | null> = {
  all_clear: "cleared",
  cleared: "cleared",
  threat: "rocket_threat",
  rocket_threat: "rocket_threat",
  danger: "danger",
  warning: "warning",
  impact: "impact",
  intercept: "intercept",
  fixation: "fixation",
  movement: "fixation",
  attention: "attention",
  pvo_work: "pvo_work",
  noise: null,
  other: null,
};

/** Код словаря для LLM-категории или null, если категория не несёт статуса. */
export function bridgeEventCategoryToCode(
  category: GeoEventCategory,
  dictionary: StatusDictionaryRecord[],
): string | null {
  const preferred = CATEGORY_PREFERRED_CODE[category];
  const active = dictionary.filter((entry) => entry.isActive);
  if (preferred && active.some((entry) => entry.code === preferred)) {
    return preferred;
  }

  const level = EVENT_CATEGORY_LEVEL[category];
  if (!level) return null;

  const byLevel = active
    .filter((entry) => entry.stateLevel === level)
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  return byLevel[0]?.code ?? null;
}
