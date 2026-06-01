export type ContentKind = "event" | "noise" | "meta";

const NOISE_PATTERNS = [
  /донат/i,
  /спасибо/i,
  /pay\.cloudtips/i,
  /новый канал/i,
  /подписаться/i,
  /мы в max/i,
  /интернет[-\s]?магазин/i,
  /almastore/i,
  /обращаем\s+(ваше\s+)?внимание\s+на/i,
  /прямые\s+поставки/i,
  /параллельн\w+\s+импорт/i,
  /промокод/i,
  /реклам/i,
];

const META_PATTERNS = [
  /президент/i,
  /минобороны/i,
  /перемирие/i,
  /украин/i,
];

// Статистические сводки (итоги за период) — не оперативное событие, а справка.
const SUMMARY_PATTERNS = [
  /за\s+(ночь|сутки|день|неделю)/i,
  /с\s+\d{1,2}[:.]\d{2}\s+до\s+\d{1,2}[:.]\d{2}/i,
  /уничтожен[оы]?\s+\d+\s+бпла/i,
];

const EVENT_HINTS = [
  /бпла/i,
  /пво/i,
  /отбой/i,
  /фиксац/i,
  /ограничения на ивп/i,
  /тревога/i,
  /опасност/i,
  /внимани/i,
];

/** Отделяет сигналы о событиях от донатов, политики и служебного шума канала. */
export function classifyContentKind(input: string): ContentKind {
  const text = input.trim();
  if (!text) return "noise";

  if (NOISE_PATTERNS.some((x) => x.test(text))) return "noise";
  if (META_PATTERNS.some((x) => x.test(text))) return "meta";
  if (SUMMARY_PATTERNS.some((x) => x.test(text))) return "meta";
  if (EVENT_HINTS.some((x) => x.test(text))) return "event";
  return "noise";
}
