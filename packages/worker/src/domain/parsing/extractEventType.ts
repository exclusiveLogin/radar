import type { EventSubject, EventType } from "@radar/shared";
import { isChannelCityListPromo } from "./channelCityListPromo.js";

/** Рекламный/коммерческий контекст: «внимание» не оперативный сигнал. */
const COMMERCIAL_NOISE = [
  /интернет[-\s]?магазин/i,
  /almastore/i,
  /обращаем\s+(ваше\s+)?внимание\s+на/i,
  /прямые\s+поставки/i,
  /параллельн\w+\s+импорт/i,
  /промокод/i,
  /реклам/i,
];

function isCommercialNoise(input: string): boolean {
  return (
    isChannelCityListPromo(input)
    || COMMERCIAL_NOISE.some((pattern) => pattern.test(input))
  );
}

/**
 * Правила распознавания типа события. Порядок ВАЖЕН: более специфичные и
 * «снимающие тревогу» правила идут раньше общих.
 *
 * Ключевые инварианты:
 * - «отбой …» (в т.ч. ракетной/авиационной опасности, без слова «бпла») = cleared,
 *   поэтому правило отбоя стоит ПЕРВЫМ и опережает rocket_threat/danger;
 * - опасность/внимание распознаются и без слова «бпла» (авиационная опасность,
 *   БЭК, «внимание по возможным пускам ракет с авиации»).
 */
const rules: Array<{ regex: RegExp; type: EventType }> = [
  // Отбой любой угрозы (опасности/внимания/тревоги), в т.ч. ракетной/авиационной — снимает уровень.
  { regex: /отбой.*(опасност|внимани|тревог|угроз)/is, type: "cleared" },

  // Фиксация (порядок слов свободный: «фиксация … БПЛА» / «БПЛА … фиксация»).
  { regex: /фиксаци(?:я|и).*бпла/is, type: "fixation" },
  { regex: /бпла.*фиксаци(?:я|и)/is, type: "fixation" },
  { regex: /множественн\w*\s+фиксаци/i, type: "fixation" },
  { regex: /от\s*\d+\s*бпла/i, type: "fixation" },

  // Поражение/сбитие цели.
  { regex: /сбит(ие|о|ы).*бпла/is, type: "impact" },

  // Работа ПВО.
  { regex: /работа\w*\s+пво/i, type: "pvo_work" },

  // Ракетная/реактивная опасность (после «отбоя», чтобы отбой не попал сюда).
  // Примечание: \w не матчит кириллицу в JS, поэтому используем явный диапазон.
  { regex: /(ракетн|реактивн)[а-яёА-ЯЁ]*\s+опасност/i, type: "rocket_threat" },

  // Массовое предупреждение: тревога / волна / приготовиться.
  { regex: /приготов\w+.*волн\w+.*бпла/is, type: "mass_warning" },
  { regex: /волн[еа].*бпла/i, type: "mass_warning" },
  { regex: /тревог[аи]/i, type: "mass_warning" },

  // Внимание (в т.ч. по пускам ракет с авиации — без слова «бпла»).
  { regex: /внимани[ея]/i, type: "attention" },
  { regex: /активност\w*.*бпла/is, type: "attention" },
  { regex: /возможн\w*\s+(групп\w*\s+)?бпла/i, type: "attention" },
  { regex: /в\s+вашем\s+направлении/i, type: "attention" },

  // Опасность общего вида (включая авиационную и БЭК) — после специфичных правил.
  { regex: /угроз[аы]\s+атак/i, type: "danger" },
  { regex: /опасност[ьи]/i, type: "danger" },

  // Меры безопасности — если ничего острее не сработало.
  { regex: /меры безопасности/i, type: "safety_measures" },

  // Ограничение использования воздушного пространства.
  { regex: /ограничени\w*\s+на\s+ивп/i, type: "airspace_restriction" },
];

/** Тип воздушной ситуации по ключевым фразам: отбой, фиксация, ПВО, опасность и т.п. */
export function extractEventType(input: string): EventType | null {
  if (isCommercialNoise(input)) return null;
  for (const rule of rules) {
    if (rule.regex.test(input)) return rule.type;
  }
  return null;
}

/**
 * Субъект угрозы по ключевым словам текста.
 * Приоритет: МВШ > ракета > авиация > БПЛА > other.
 * Вызывается независимо от eventType — правила не пересекаются по смыслу.
 */
export function extractEventSubject(input: string): EventSubject {
  if (/мвш|массиров[а-яёА-ЯЁ]*\s+(ракет|удар)/i.test(input)) return "mws";
  if (/ракетн|реактивн/i.test(input)) return "rocket";
  if (/авіац|авиац/i.test(input)) return "aviation";
  if (/бпла|дрон|беспилот/i.test(input)) return "drone";
  return "other";
}
