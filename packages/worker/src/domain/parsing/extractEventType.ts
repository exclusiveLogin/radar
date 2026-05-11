import type { EventType } from "@radar/shared";

const rules: Array<{ regex: RegExp; type: EventType }> = [
  // fixation: order-independent (БПЛА may appear before or after "фиксация")
  { regex: /фиксаци(?:я|и).*бпла/is, type: "fixation" },
  { regex: /бпла.*фиксаци(?:я|и)/is, type: "fixation" },
  { regex: /множественн\w*\s+фиксаци/i, type: "fixation" },
  { regex: /от\s*\d+\s*бпла/i, type: "fixation" },
  // cleared
  { regex: /отбой.*(опасност|внимани).*(бпла)/i, type: "cleared" },
  // attention / warning
  { regex: /внимани[ея].*(бпла)/i, type: "attention" },
  { regex: /приготов\w+.*волн\w+.*бпла/is, type: "mass_warning" },
  { regex: /волн[еа].*бпла/i, type: "mass_warning" },
  { regex: /тревога.*(бпла)/i, type: "mass_warning" },
  // danger
  { regex: /угроз[аы]\s+атак[аи].*(бпла)/i, type: "danger" },
  { regex: /опасност[ьи].*(бпла)/i, type: "danger" },
  // other
  { regex: /работа пво/i, type: "pvo_work" },
  { regex: /сбит(ие|о).*(бпла)/i, type: "impact" },
  { regex: /меры безопасности/i, type: "safety_measures" },
  { regex: /(ракетн|реактивн).*(опасност)/i, type: "rocket_threat" },
  { regex: /ограничения на ивп/i, type: "airspace_restriction" },
];

/** Тип воздушной ситуации по ключевым фразам: фиксация, отбой, ПВО, ограничение ИВП и т.п. */
export function extractEventType(input: string): EventType | null {
  for (const rule of rules) {
    if (rule.regex.test(input)) return rule.type;
  }
  return null;
}
