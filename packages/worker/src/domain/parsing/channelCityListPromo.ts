/**
 * Рекламные посты с перечнем городских Telegram-каналов («Москва 24/7», …).
 * Не оперативная тревога: не классифицируем как event и не геокодируем список.
 */

import { isGeoPhraseStopword, normalizePlaceMatchLabel } from "@radar/shared";

/** Суффикс бренда канала — убираем перед lookup в справочнике НП. */
export function stripChannelPlaceSuffix(placeName: string): string {
  return placeName.replace(/\s+24\s*\/\s*7\s*$/i, "").trim();
}

/** Бренд канала «Город 24/7» — не оперативный топоним. */
export function isChannelBrandPlaceName(placeName: string): boolean {
  return /\s24\s*\/\s*7\s*$/i.test(placeName.trim());
}

/** Убирает статусные эмодзи/маркеры канала в начале названия (🟡Актарск → Актарск). */
export function stripChannelStatusPrefix(placeName: string): string {
  let value = placeName.trim();
  for (let pass = 0; pass < 3; pass += 1) {
    const next = value
      .replace(/^[\s#*•\-—–]+/, "")
      .replace(/^(?:[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F]+)+/u, "")
      .trim();
    if (next === value) break;
    value = next;
  }
  return value;
}

/** Служебные строки канала — не топонимы для геокодера. */
const NON_GEOCODABLE_PLACE_PATTERNS: RegExp[] = [
  /канал\s+тревог/i,
  /последнее\s+обновление/i,
  /\bв\s+MAX\b/i,
  /\bMAX\s*$/i,
  /и\s+ближайш/i,
  /и\s+ближайшее/i,
  /(?:^|\s)нпз(?:\s|$)/i,
  /телеграм/i,
  /подписывай/i,
  /обход\s+белых\s+списков/i,
  /радар\s+по\s+всей\s+россии/i,
  /^повторно\.?$/i,
  /^предварительно\.?$/i,
  /^отдельный\.?$/i,
  /^пока\s+единичн/i,
  /^ещё\s+группа/i,
  /^выделенный\s+район/i,
  /воздушная\s+тревога/i,
  /^можно\s+покидать/i,
  /^сохраня/i,
  /^следим\s+за/i,
  /^ложная\s+тревога/i,
  /^отмена\s+сигнала/i,
  /^берегите\s+себя/i,
  /^огромное\s+количество/i,
  /^весь\s+северо/i,
  /транзитом\s+через/i,
  /^от\s+[а-яё][а-яё\s-]*област/i,
  /(?:^|\s)[а-яё-]+ской\s+области$/i,
  /^республик\s+/i,
  /^республик[аиу]\s+/i,
  /^[а-яё-]+,\s*[а-яё-]+,\s*[а-яё-]+,\s*[а-яё-]+/i,
  /[\r\n]/,
  /дрон\s+в\s+небе/i,
  /от\s+\d+\s+дрон/i,
  /\d+\s+дрон/i,
  /над\s+городом/i,
  /в\s+направлени[еяю]/i,
  /^и\s+далее\s+в\s+направлени/i,
  /^в\s+направлени/i,
  /^в\s+сторону\s+республик/i,
  /трасса\s+/i,
  /побережь/i,
  /^всё\s+/i,
  /цели.*уничтожен/i,
  /воздушн.*цел/i,
  /воздушн.*уничтожен/i,
  /^прошло\s+уже/i,
  /^летит\s+очень/i,
  /^очень\s+низко/i,
  /ботанический\s+сад/i,
  /^жд\s+вокзал/i,
  /\s\/\s/,
  /обстановка\s+спокойн/i,
  /приготовит/i,
  /курс\s+мвш/i,
  /пкр\s*«/i,
  /ещё\s+\d+/i,
  /от\s+акватории/i,
  /атака\s+на/i,
  /нефтебаз/i,
  /не\s+в\s+известном\s+направлении/i,
  /^запад$/i,
  /^север$/i,
];

/** Субъект РФ как «место» (Чувашия, Мордовия) — не НП. */
const FEDERAL_SUBJECT_AS_PLACE = /^(?:чувашия|мордовия|татарстан|башкортостан|удмуртия)(?:\s+республика)?$/i;

function isTimestampLikePlaceLabel(label: string): boolean {
  if (/^\d{6,}/.test(label)) return true;
  if (/\d{6,}\s+\d{4,}/.test(label)) return true;
  if (/\(\s*мск\s*\)/i.test(label) && /\d{4,}/.test(label)) return true;
  if (/^\d{3,4}\s*\(\s*мск\s*\)/i.test(label)) return true;
  return false;
}

/**
 * Нормализация подписи канала → топоним для DaData/Nominatim.
 * «🟢Адлер и близлежащие» → «Адлер», «ГО Подольск» → «Подольск».
 */
export function normalizePlaceLabelForGeocode(placeName: string): string {
  let label = stripChannelStatusPrefix(placeName).replace(/\r/g, "").split("\n")[0]!.trim();
  label = normalizePlaceMatchLabel(label);
  label = label.replace(/\s+и\s+(?:близлежащ(?:ие|ие)|ближайш(?:ие|ее)|ближайшее|пригород)(?:\s+\p{L}+)?$/iu, "");
  return label.trim();
}

/**
 * Имя не годится для ingest place: канал-бренд, простыня текста, promo-маркеры.
 * Place без валидного топонима не создаём — регион привязывается только к НП.
 */
export function isGarbageIngestPlaceName(placeName: string): boolean {
  const trimmed = stripChannelStatusPrefix(placeName);
  const normalized = normalizePlaceLabelForGeocode(placeName);
  if (!trimmed || !normalized || trimmed.length > 80) {
    return true;
  }
  if (isGeoPhraseStopword(normalized.toLowerCase())) {
    return true;
  }
  if (isChannelBrandPlaceName(trimmed) || isChannelBrandPlaceName(normalized)) {
    return true;
  }
  if (FEDERAL_SUBJECT_AS_PLACE.test(normalized)) {
    return true;
  }
  if (
    NON_GEOCODABLE_PLACE_PATTERNS.some(
      (pattern) => pattern.test(trimmed) || pattern.test(normalized),
    )
  ) {
    return true;
  }
  if (isTimestampLikePlaceLabel(trimmed) || isTimestampLikePlaceLabel(normalized)) {
    return true;
  }
  if (/^(?:впервые|в некоторых|создать\s+телеграм|подписывай)/iu.test(trimmed)) {
    return true;
  }
  if (/(?:ракет|атак|всу|дрон|тревог|телеграм\s+канал)/iu.test(trimmed)) {
    return true;
  }
  if (/^просим\s+сохраня/i.test(trimmed)) {
    return true;
  }
  return false;
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
