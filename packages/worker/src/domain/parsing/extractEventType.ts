import type { EventSubject, EventType } from "@radar/shared";

import { isChannelCityListPromo } from "./channelCityListPromo.js";
import { CONSEQUENCE_TYPE_RULES } from "./consequencePhrases.js";



/** Суффикс кириллических окончаний (JS: \w не матчит кириллицу). */

const CYR_SUFFIX = "[а-яёА-ЯЁ]*";



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

 * Правила распознавания типа события (first-match в одном проходе).

 * Массовость — trait mass, не тип. «Отбой» и сводки ПВО — раньше общих правил.

 */

const rules: Array<{ regex: RegExp; type: EventType }> = [

  {
    regex: /отбой.*(?:по\s+(?:всем|всех)|всем\s+ранее\s+объявлен|ранее\s+объявлен)/is,
    type: "cleared",
  },

  { regex: /отбой.*(опасност|внимани|тревог|угроз)/is, type: "cleared" },

  { regex: /отмен[аы]\s+сигнал[аы]?.*опасност/is, type: "cleared" },

  { regex: /внимани[ея].*отбой.*(?:тревог|воздушн)/is, type: "cleared" },

  { regex: /отбой.*воздушн[а-яёА-ЯЁ]*\s+тревог/is, type: "cleared" },



  {

    regex: new RegExp(

      `уничтожен${CYR_SUFFIX}\\s+\\d+\\s+(?:украинских\\s+)?(?:бпла|беспилотн)`,

      "i",

    ),

    type: "pvo_report",

  },

  {

    regex: new RegExp(

      `перехвачен${CYR_SUFFIX}\\s+и\\s+уничтожен${CYR_SUFFIX}\\s+\\d+`,

      "i",

    ),

    type: "pvo_report",

  },

  {

    regex: /силами\s+(?:пво|противо?воздушной\s+обороны)\s+было\s+уничтожено/i,

    type: "pvo_report",

  },



  { regex: /прол[её]т.*(?:бпла|дрон|беспилот)/is, type: "fixation" },

  { regex: /пролет\s+реактивн/is, type: "fixation" },

  { regex: /прол[её]т(?:\s|[,.]|$)/i, type: "fixation" },

  { regex: /от\s*\d+\s*бпла/i, type: "fixation" },

  { regex: /(?:бпла|дрон).*над\s+городом/is, type: "fixation" },

  { regex: /дрон\s+в\s+небе/is, type: "fixation" },

  { regex: /(?:бпла|дрон)\s+прош[её]л/is, type: "fixation" },

  { regex: /прошл[а-яёА-ЯЁ]*\s+групп[а-яёА-ЯЁ]*\s+бпла/is, type: "fixation" },

  { regex: /в\s+направлении.*бпла/is, type: "fixation" },

  // Обратный порядок: «Группа БПЛА … в направлении X» (бпла раньше «в направлении»).
  // «в направлении» (но не «в вашем направлении» → attention) = подтверждённое движение.
  { regex: /бпла.*в\s+направлении/is, type: "fixation" },

  { regex: /(?:^|[\s,.])дрон!?\s*$/im, type: "fixation" },

  { regex: /фиксаци(?:я|и)/i, type: "fixation" },



  { regex: /сбити[ея]\s+(?:бпла|мвш|ракет)/i, type: "intercept" },

  { regex: /^сбитие!?\s*$/im, type: "intercept" },

  { regex: /сбитие\s+цел/i, type: "intercept" },

  { regex: /начались?\s+сбити[яей]/i, type: "intercept" },

  { regex: /сбити[яей]\s+(?:бпла|мвш)\s+продолжа/i, type: "intercept" },

  { regex: /продолжаются\s+сбити[яей]/i, type: "intercept" },



  {

    regex: new RegExp(

      `уничтожен${CYR_SUFFIX}(?!\\s+\\d)(?:.|\\n)*?(?:бпла|дрон|беспилот)`,

      "is",

    ),

    type: "impact",

  },

  {

    regex: /(?:бпла|дрон|беспилот).*уничтожен/i,

    type: "impact",

  },

  { regex: /погибл[а-яёА-ЯЁ]*.*бпла/is, type: "impact" },

  { regex: /пострадал[а-яёА-ЯЁ]*.*бпла/is, type: "impact" },



  {

    regex: new RegExp(`приготов${CYR_SUFFIX}.*(?:бпла|появлен)`, "is"),

    type: "warning",

  },

  {

    regex: new RegExp(`приготов${CYR_SUFFIX}.*сбитию`, "is"),

    type: "warning",

  },

  {

    regex: new RegExp(`приготов${CYR_SUFFIX}.*волн${CYR_SUFFIX}.*бпла`, "is"),

    type: "warning",

  },

  { regex: /волн[еа].*бпла/i, type: "warning" },

  { regex: /тревог[аи].*бпла.*сохраняется/is, type: "warning" },

  // Фразы-последствия (SSOT `consequencePhrases`): «осколки/под осколки» → pvo_work.
  // Позиция важна: ниже «…сохраняется», но выше общих тревога/опасность.
  ...CONSEQUENCE_TYPE_RULES,

  { regex: /тревог[аи]/i, type: "warning" },



  { regex: /сбит[оы](?:\s|[^а-яё]).*бпла/is, type: "impact" },



  { regex: /(?:работа|работает)\w*\s+(?:пво|мог)/i, type: "pvo_work" },



  { regex: /(ракетн|реактивн)[а-яёА-ЯЁ]*\s+опасност/i, type: "rocket_threat" },



  { regex: /внимани[ея]/i, type: "attention" },

  { regex: /активност\w*.*бпла/is, type: "attention" },

  { regex: /возможн[а-яёА-ЯЁ]*\s+(?:групп[а-яёА-ЯЁ]*\s+)?бпла/i, type: "attention" },

  { regex: /в\s+вашем\s+направлении/i, type: "attention" },



  { regex: /угроз[аы]\s+атак/i, type: "danger" },

  { regex: /(?<![а-яёА-ЯЁ])опасност[ьи]/i, type: "danger" },



  { regex: /меры безопасности/i, type: "safety_measures" },

  { regex: /ограничени\w*\s+на\s+ивп/i, type: "airspace_restriction" },

];



/** Тип воздушной ситуации по ключевым фразам. */

export function extractEventType(input: string): EventType | null {

  if (isCommercialNoise(input)) return null;

  for (const rule of rules) {

    if (rule.regex.test(input)) return rule.type;

  }

  return null;

}



/** Субъект угрозы по ключевым словам текста. */

export function extractEventSubject(input: string): EventSubject {

  if (/мвш|массиров[а-яёА-ЯЁ]*\s+(ракет|удар)/i.test(input)) return "mws";

  if (/ракетн|реактивн/i.test(input)) return "rocket";

  if (/авіац|авиац/i.test(input)) return "aviation";

  if (/бпла|дрон|беспилот/i.test(input)) return "drone";

  return "other";

}

