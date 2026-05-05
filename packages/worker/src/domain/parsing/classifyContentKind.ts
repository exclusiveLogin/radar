export type ContentKind = "event" | "noise" | "meta";

const NOISE_PATTERNS = [
  /донат/i,
  /спасибо/i,
  /pay\.cloudtips/i,
  /новый канал/i,
  /подписаться/i,
  /мы в max/i,
];

const META_PATTERNS = [
  /президент/i,
  /минобороны/i,
  /перемирие/i,
  /украин/i,
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

export function classifyContentKind(input: string): ContentKind {
  const text = input.trim();
  if (!text) return "noise";

  if (NOISE_PATTERNS.some((x) => x.test(text))) return "noise";
  if (META_PATTERNS.some((x) => x.test(text))) return "meta";
  if (EVENT_HINTS.some((x) => x.test(text))) return "event";
  return "noise";
}
