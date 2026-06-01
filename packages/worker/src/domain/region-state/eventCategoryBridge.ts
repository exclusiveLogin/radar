/**
 * Мост LLM-категории события (`eventCategory`, 5 классов) к коду словаря статусов
 * (ADR-003, Фаза E). Словарь — SSOT: предпочтительный код применяется только если
 * он есть и активен; иначе берём представителя целевого `state_level`.
 *
 * Атрибут eventType в проекции: при равном precision побеждает источник с большим
 * trust (LLM > rule). Категория other → отбой через all_clear (снятие ложной тревоги).
 */
import type { GeoEventCategory, StateLevel, StatusDictionaryRecord } from "@radar/shared";

/** Целевой уровень состояния для каждой LLM-категории. */
export const EVENT_CATEGORY_LEVEL: Record<GeoEventCategory, StateLevel | null> = {
  all_clear: "green",
  impact: "red",
  threat: "orange",
  movement: "red",
  other: null,
};

/** Предпочтительный код словаря (валидируется по фактическому словарю). */
const CATEGORY_PREFERRED_CODE: Record<GeoEventCategory, string | null> = {
  threat: "rocket_threat",
  impact: "impact",
  all_clear: "cleared",
  movement: "fixation",
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

  // Представитель уровня с наивысшим приоритетом (меньшее число = выше).
  const byLevel = active
    .filter((entry) => entry.stateLevel === level)
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  return byLevel[0]?.code ?? null;
}
