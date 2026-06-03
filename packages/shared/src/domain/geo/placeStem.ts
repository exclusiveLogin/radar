/**
 * Нормализует название места в стем для быстрого матча без alias-роста.
 *
 * Алгоритм:
 *  1. Нижний регистр + замена ё→е
 *  2. Удаление типовых суффиксов/префиксов (район, область, республика, город…)
 *  3. Удаление дефисов и незначимых символов
 *  4. Trim пробелов
 *
 * Использование:
 *  - При импорте geo_feature и catalog place → place.name_stem
 *  - При parse validate → сравнение стема входящего имени с name_stem в БД
 *
 * SSOT: единственная функция нормализации для матча — не дублировать логику.
 */

const STOP_WORDS = [
  // Типы АТЕ
  "район",
  "муниципальный район",
  "городской округ",
  "муниципальный округ",
  "область",
  "республика",
  "автономный округ",
  "автономная область",
  "край",
  "округ",
  "город",
  "посёлок",
  "поселок",
  "деревня",
  "село",
  "станица",
  "хутор",
  // Сокращения
  "р-н",
  "г",
  "обл",
  "респ",
  "ао",
  "мо",
];

/** Таблица символьных замен для нормализации. */
const CHAR_REPLACEMENTS: Array<[RegExp, string]> = [
  [/ё/g, "е"],
  [/й/g, "и"],
  // Дефис в составных названиях оставляем для "Ханты-Мансийск" → "хантымансии"
  [/-/g, ""],
  [/[^а-яa-z0-9\s]/gi, " "],
  [/\s+/g, " "],
];

/** Основная точка входа: normalizes place name to a compact stem. */
export function placeStem(name: string): string {
  if (!name) return "";

  let value = name.toLowerCase().trim();

  // Символьные замены
  for (const [pattern, replacement] of CHAR_REPLACEMENTS) {
    value = value.replace(pattern, replacement);
  }

  // Удаляем стоп-слова с краёв (сначала полные фразы, потом однословные)
  for (const stopWord of STOP_WORDS) {
    const normalized = stopWord.replace(/ё/g, "е");
    value = value
      .replace(new RegExp(`^${normalized}\\s+`, "g"), "")
      .replace(new RegExp(`\\s+${normalized}$`, "g"), "");
  }

  return value.trim();
}
