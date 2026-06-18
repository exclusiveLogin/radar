import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { MessageBlock } from "@radar/shared";

type SegmenterRules = {
  promoPatterns: RegExp[];
  footerPatterns: RegExp[];
  signalPatterns: RegExp[];
  geoPatterns: RegExp[];
  statsPatterns: RegExp[];
};

const DEFAULT_RULES: SegmenterRules = {
  promoPatterns: [/подпис|24\/7|t\.me\//i, /промокод/i],
  footerPatterns: [/подписывайтесь/i],
  signalPatterns: [/опасност|внимани|отбой|тревог|сбит|фиксаци|перехват/i],
  geoPatterns: [/област|край|республик|город|район/i],
  statsPatterns: [/уничтожен|перехвачен|итог/i],
};

function parseYamlPatternList(raw: string, sectionKey: string): string[] {
  const lines = raw.split("\n");
  const patterns: string[] = [];
  let inSection = false;
  for (const line of lines) {
    if (line.startsWith(`${sectionKey}:`)) {
      inSection = true;
      continue;
    }
    if (inSection && /^\w+Patterns:/.test(line.trim())) break;
    if (inSection && line.trim().startsWith("- ")) {
      patterns.push(line.trim().slice(2).replace(/^"|"$/g, ""));
    }
  }
  return patterns;
}

function toRules(raw: string): SegmenterRules {
  const section = (key: string) =>
    parseYamlPatternList(raw, key).map((pattern) => new RegExp(pattern, "i"));
  return {
    promoPatterns: section("promoPatterns"),
    footerPatterns: section("footerPatterns"),
    signalPatterns: section("signalPatterns"),
    geoPatterns: section("geoPatterns"),
    statsPatterns: section("statsPatterns"),
  };
}

let cachedRules: SegmenterRules | null = null;

function loadSegmenterRules(): SegmenterRules {
  if (cachedRules) return cachedRules;
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, "../../../../../data/parse/segmenter-rules.v1.yaml");
  try {
    cachedRules = toRules(readFileSync(path, "utf8"));
  } catch {
    cachedRules = DEFAULT_RULES;
  }
  return cachedRules;
}

function classifyLine(text: string, rules: SegmenterRules): MessageBlock["kind"] {
  if (rules.promoPatterns.some((p) => p.test(text))) return "promo";
  if (rules.footerPatterns.some((p) => p.test(text))) return "footer";
  if (rules.statsPatterns.some((p) => p.test(text))) return "stats";
  if (rules.signalPatterns.some((p) => p.test(text))) return "signal";
  if (rules.geoPatterns.some((p) => p.test(text))) return "geo";
  return "unknown";
}

/** Семантическая сегментация v1: split + role classification. */
export function segmentMessage(text: string): MessageBlock[] {
  const rules = loadSegmenterRules();
  const parts = text
    .split(/\n+|[|;]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  let offset = 0;
  const blocks: MessageBlock[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!;
    const start = text.indexOf(part, offset);
    const end = start >= 0 ? start + part.length : offset + part.length;
    offset = end;
    blocks.push({
      id: `block-${i}`,
      kind: classifyLine(part, rules),
      text: part,
      span: { start: Math.max(0, start), end },
    });
  }

  if (blocks.length === 0) {
    blocks.push({
      id: "block-0",
      kind: "unknown",
      text,
      span: { start: 0, end: text.length },
    });
  }

  return blocks;
}
