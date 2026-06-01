/**
 * Рекламные посты с перечнем городских Telegram-каналов («Москва 24/7», …).
 * Не оперативная тревога: не классифицируем как event и не геокодируем список.
 */

/** Суффикс бренда канала — убираем перед lookup в справочнике НП. */
export function stripChannelPlaceSuffix(placeName: string): string {
  return placeName.replace(/\s+24\s*\/\s*7\s*$/i, "").trim();
}

/** Строки вида «Город 24/7» в тексте. */
function countCity247Lines(text: string): number {
  return (text.match(/[^\n\r]{1,80}?\s+24\s*\/\s*7/gi) ?? []).length;
}

/** Маркеры рекламы сети каналов, а не боевой сводки. */
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

/** Рекламный перечень городских каналов — шум ingest/parse. */
export function isChannelCityListPromo(input: string): boolean {
  const text = input.trim();
  if (!text) {
    return false;
  }

  const city247Lines = countCity247Lines(text);
  if (city247Lines >= 3) {
    return true;
  }

  if (hasChannelNetworkPromoHints(text) && city247Lines >= 2) {
    return true;
  }

  if (hasChannelNetworkPromoHints(text) && /❗.*тревог/i.test(text) && city247Lines >= 1) {
    return true;
  }

  return false;
}
