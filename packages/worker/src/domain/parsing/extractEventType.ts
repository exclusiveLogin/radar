import type { EventType } from "@radar/shared";

const rules: Array<{ regex: RegExp; type: EventType }> = [
  { regex: /фиксаци(?:я|и).*(бпла)/i, type: "fixation" },
  { regex: /внимани[ея].*(бпла)/i, type: "attention" },
  { regex: /опасност[ьи].*(бпла)/i, type: "danger" },
  { regex: /отбой.*(опасност|внимани).*(бпла)/i, type: "cleared" },
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
