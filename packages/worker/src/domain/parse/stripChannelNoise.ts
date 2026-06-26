import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** Inline-паттерны promo/footer канала (SSOT с segmenter-rules + stripSignature). */
const INLINE_NOISE_PATTERNS: RegExp[] = [
  /❗️\s*Радар/i,
  /🌐\s*Обход/i,
  /🔵\s*Подписаться/i,
  /📲\s*Мы в MAX/i,
  /📲\s*Канал\s+тревог/i,
  /⏰\s*Последнее\s+обновление/i,
  /https?:\/\//i,
  /@[\w_]+/i,
  /t\.me\//i,
  /подпис/i,
  /24\/7/i,
  /промокод/i,
  /подписывайтесь/i,
  /чат[-\s]?бот/i,
  /сообщить\s+в\s+(?:чат[-\s]?)?бот/i,
  /@\w+_bot/i,
  /obxod|обход.*vpn/i,
];

function loadYamlInlinePatterns(): RegExp[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, "../../../../../data/parse/segmenter-rules.v1.yaml");
  try {
    const raw = readFileSync(path, "utf8");
    const parseSection = (key: string): RegExp[] => {
      const lines = raw.split("\n");
      const patterns: string[] = [];
      let inSection = false;
      for (const line of lines) {
        if (line.startsWith(`${key}:`)) {
          inSection = true;
          continue;
        }
        if (inSection && /^\w+Patterns:/.test(line.trim())) break;
        if (inSection && line.trim().startsWith("- ")) {
          patterns.push(line.trim().slice(2).replace(/^"|"$/g, ""));
        }
      }
      return patterns.map((p) => new RegExp(p, "i"));
    };
    // Footer-паттерны (в т.ч. «Меры безопасности») — только segmenter; здесь только promo/CTA.
    return parseSection("promoPatterns");
  } catch {
    return [];
  }
}

let cachedPatterns: RegExp[] | null = null;

function allInlinePatterns(): RegExp[] {
  if (!cachedPatterns) {
    cachedPatterns = [...INLINE_NOISE_PATTERNS, ...loadYamlInlinePatterns()];
  }
  return cachedPatterns;
}

/**
 * Обрезает promo/CTA канала по первому inline-совпадению (❗️Радар, @bot, t.me).
 * Footer-строки («Меры безопасности» на отдельной строке) — только segmenter, не здесь:
 * в one-liner «Город … Меры безопасности» это сигнал, а не хвост.
 */
export function stripInlineChannelNoise(text: string): string {
  let earliest = text.length;
  for (const pattern of allInlinePatterns()) {
    const match = pattern.exec(text);
    if (match && match.index < earliest) {
      earliest = match.index;
    }
  }
  if (earliest >= text.length) return text.trim();
  return text.slice(0, earliest).trim();
}
