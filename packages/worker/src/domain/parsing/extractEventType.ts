import type { EventType } from "@radar/shared";

const rules: Array<{ regex: RegExp; type: EventType }> = [
  { regex: /фиксаци(?:я|и).*(бпла)/i, type: "fixation" },
  { regex: /от\s*\d+\s*бпла/i, type: "fixation" },
  { regex: /отбой.*(опасност|внимани).*(бпла)/i, type: "cleared" },
  { regex: /внимани[ея].*(бпла)/i, type: "attention" },
  { regex: /угроз[аы]\s+атак[аи].*(бпла)/i, type: "danger" },
  { regex: /опасност[ьи].*(бпла)/i, type: "danger" },
  { regex: /работа пво/i, type: "pvo_work" },
  { regex: /сбит(ие|о).*(бпла)/i, type: "impact" },
  { regex: /меры безопасности/i, type: "safety_measures" },
  { regex: /(ракетн|реактивн).*(опасност)/i, type: "rocket_threat" },
  { regex: /ограничения на ивп/i, type: "airspace_restriction" },
  { regex: /тревога.*(бпла)/i, type: "mass_warning" },
];

export function extractEventType(input: string): EventType | null {
  for (const rule of rules) {
    if (rule.regex.test(input)) return rule.type;
  }
  return null;
}
