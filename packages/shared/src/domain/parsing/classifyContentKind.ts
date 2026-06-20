/**
 * Классификация текста raw для ленты «Сообщения» (read-side label + groom SSOT).
 * isChannelCityListPromo — локальная копия минимального контракта без worker-only deps.
 */

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

const SUMMARY_PATTERNS = [
  /за\s+(ночь|сутки|день|неделю)/i,
  /с\s+\d{1,2}[:.]\d{2}\s+до\s+\d{1,2}[:.]\d{2}/i,
  /уничтожен[оы]?\s+\d+\s+бпла/i,
];

const EVENT_HINTS = [
  /бпла/i,
  /дрон/i,
  /прол[её]т/i,
  /пво/i,
  /отбой/i,
  /фиксац/i,
  /ограничения на ивп/i,
  /тревога/i,
  /опасност/i,
  /внимани/i,
];

function countCity247Lines(text: string): number {
  return (text.match(/[^\n\r]{1,80}?\s+24\s*\/\s*7/gi) ?? []).length;
}

function hasChannelNetworkPromoHints(text: string): boolean {
  return (
    /ищите\s+свой\s+регион/i.test(text)
    || /подписывайтесь/i.test(text)
    || /телеграм\s+канал/i.test(text)
    || /нет\s+вашего\s+региона/i.test(text)
    || /не\s+будут\s+блокироват/i.test(text)
    || /создать\s+телеграм/i.test(text)
  );
}

function isChannelCityListPromo(input: string): boolean {
  const text = input.trim();
  if (!text) return false;
  const city247Lines = countCity247Lines(text);
  if (city247Lines >= 3) return true;
  if (hasChannelNetworkPromoHints(text) && city247Lines >= 2) return true;
  if (hasChannelNetworkPromoHints(text) && /❗.*тревог/i.test(text) && city247Lines >= 1) {
    return true;
  }
  return false;
}

/** Отделяет сигналы о событиях от донатов, политики и служебного шума канала. */
export function classifyContentKind(input: string): ContentKind {
  const text = input.trim();
  if (!text) return "noise";

  if (isChannelCityListPromo(text)) return "noise";
  if (NOISE_PATTERNS.some((x) => x.test(text))) return "noise";
  if (META_PATTERNS.some((x) => x.test(text))) return "meta";
  if (SUMMARY_PATTERNS.some((x) => x.test(text))) return "meta";
  if (EVENT_HINTS.some((x) => x.test(text))) return "event";
  return "noise";
}
