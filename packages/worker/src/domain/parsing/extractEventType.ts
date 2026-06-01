import type { EventType } from "@radar/shared";

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
  return COMMERCIAL_NOISE.some((pattern) => pattern.test(input));
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
  { regex: /(ракетн|реактивн)\w*\s+опасност/i, type: "rocket_threat" },

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
