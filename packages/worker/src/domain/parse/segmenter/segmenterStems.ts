import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** Русские окончания signal-слов (без \\b — Cyrillic word boundary ненадёжен). */
const SIGNAL_STEM_SUFFIXES = "(?:ь|и|ью|я|ю|е|а|о)?";

/** Русские окончания stats-слов. */
const STATS_STEM_SUFFIXES = "(?:ен|ен|а|о|ы|и)?";

const DEFAULT_SIGNAL_STEMS = [
  "опасност",
  "внимани",
  "отбой",
  "тревог",
  "сбит",
  "фиксаци",
  "перехват",
] as const;

const DEFAULT_STATS_STEMS = ["уничтожен", "перехвачен", "итог"] as const;

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
      const value = line.trim().slice(2).replace(/^"|"$/g, "");
      patterns.push(...value.split("|").map((s) => s.trim()).filter(Boolean));
    }
  }
  return patterns;
}

function loadStemsFromYaml(): { signal: string[]; stats: string[] } {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, "../../../../../data/parse/segmenter-rules.v1.yaml");
  try {
    const raw = readFileSync(path, "utf8");
    return {
      signal: parseYamlPatternList(raw, "signalPatterns"),
      stats: parseYamlPatternList(raw, "statsPatterns"),
    };
  } catch {
    return {
      signal: [...DEFAULT_SIGNAL_STEMS],
      stats: [...DEFAULT_STATS_STEMS],
    };
  }
}

let cachedStems: { signal: string[]; stats: string[] } | null = null;

/** SSOT stems для split/classify (из segmenter-rules.v1.yaml). */
export function getSegmenterStems(): { signal: string[]; stats: string[] } {
  if (!cachedStems) cachedStems = loadStemsFromYaml();
  return cachedStems;
}

/** Regex split перед signal/stats token (lookahead, без trailing \\b). */
export function buildSignalStatsSplitPattern(): RegExp {
  const { signal, stats } = getSegmenterStems();
  const signalPart = signal.map((s) => `${s}${SIGNAL_STEM_SUFFIXES}`).join("|");
  const statsPart = stats.map((s) => `${s}${STATS_STEM_SUFFIXES}`).join("|");
  return new RegExp(`\\s+(?=(?:${signalPart}|${statsPart}))`, "iu");
}
