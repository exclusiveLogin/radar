import * as fs from "node:fs";
import * as path from "node:path";

export type RegionCatalogEntry = {
  code: string;
  name: string;
  fiasId?: string;
  federalDistrict?: string;
  aliases: string[];
};
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/["'`]/g, "")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  result.push(current);
  return result;
}

/** Падежи прилагательных («Калужская область» в тексте часто «Калужскую», «Орловской»). */
function expandRegionalAdjectiveForms(alias: string): string[] {
  const out = new Set<string>([alias]);
  const fem = alias.match(/^(.+)(ская)$/);
  if (fem?.[1]) {
    const stem = fem[1];
    out.add(`${stem}скую`);
    out.add(`${stem}ской`);
    out.add(`${stem}ские`);
    out.add(`${stem}ских`);
  }
  return [...out];
}
function buildAliases(name: string, nameWithType?: string): string[] {
  const values = [name, nameWithType].filter(Boolean) as string[];
  const aliases = new Set<string>();

  for (const value of values) {
    const normalized = normalize(value);
    aliases.add(normalized);
    const withoutType = normalized
      .replace(
        /(?:^|\s)(обл|область|респ|республика|край|ао|автономный округ)(?=\s|$)/g,
        " ",
      )
      .replace(/\s+/g, " ")
      .trim();
    aliases.add(withoutType);

    const adjectiveStem = withoutType.replace(/(ская|ский|ское|ские)$/i, "").trim();
    if (adjectiveStem.length >= 5) {
      aliases.add(adjectiveStem);
    }

  }

  const expanded = new Set<string>();
  for (const a of aliases) {
    for (const e of expandRegionalAdjectiveForms(a)) {
      expanded.add(e);
    }
  }
  return [...expanded].filter(Boolean);
}

type RegionMatch = {
  entry: RegionCatalogEntry;
  index: number;
  aliasLength: number;
};

export class RegionCatalog {
  private readonly entries: RegionCatalogEntry[];

  private constructor(entries: RegionCatalogEntry[]) {
    this.entries = entries;
  }
static loadFromCsv(csvPath: string): RegionCatalog {
    const source = fs.readFileSync(csvPath, "utf8");
    const lines = source.split(/\r?\n/).filter(Boolean);
    const rows = lines.slice(1);

    const entries: RegionCatalogEntry[] = rows
      .map((line) => parseCsvLine(line))
      .filter((parts) => parts.length >= 6)
      .map((parts) => {
        const [name, type, nameWithType, federalDistrict, _kladrId, fiasId] = parts;
        const isoCode = parts[10] ?? "";
        const regionCode = isoCode.startsWith("RU-") ? isoCode.slice(3) : "";
        const resolvedCode = /\d{2}/.test(parts[4] ?? "") ? (parts[4] ?? "").slice(0, 2) : regionCode;

        const fullName = nameWithType?.trim() || `${type} ${name}`.trim();
        return {
          code: resolvedCode,
          name: fullName,
          fiasId: fiasId || undefined,
          federalDistrict: federalDistrict || undefined,
          aliases: buildAliases(name, nameWithType),
        };
      })
      .filter((entry) => entry.code.length > 0);

    return new RegionCatalog(entries);
  }
getByCode(code: string): RegionCatalogEntry | null {
    const normalized = code.trim();
    return this.entries.find((entry) => entry.code === normalized) ?? null;
  }
findRegionsInText(rawText: string): RegionCatalogEntry[] {
    // Запятые и прочая пунктуация иначе ломают границы слов: "калужскую, орловскую"
    const punctStripped = normalize(rawText)
      .replace(/[,;:.!?()[\]{}«»""''–—−]/g, " ")
      .replace(/\s+/g, " ");
    const haystack = ` ${punctStripped} `;
    const matchesByCode = new Map<string, RegionMatch>();

    for (const entry of this.entries) {
      for (const alias of entry.aliases) {
        if (!alias) {
          continue;
        }

        const pattern = ` ${alias} `;
        const index = haystack.indexOf(pattern);
        if (index < 0) {
          continue;
        }

        const current = matchesByCode.get(entry.code);
        const next: RegionMatch = { entry, index, aliasLength: alias.length };
        if (!current) {
          matchesByCode.set(entry.code, next);
          continue;
        }

        const shouldReplace =
          next.index < current.index ||
          (next.index === current.index && next.aliasLength > current.aliasLength);
        if (shouldReplace) {
          matchesByCode.set(entry.code, next);
        }
      }
    }

    return [...matchesByCode.values()]
      .sort((a, b) => {
        if (a.index !== b.index) {
          return a.index - b.index;
        }
        return b.aliasLength - a.aliasLength;
      })
      .map((match) => match.entry);
  }
findRegionInText(rawText: string): RegionCatalogEntry | null {
    return this.findRegionsInText(rawText)[0] ?? null;
  }
list(): RegionCatalogEntry[] {
    return this.entries;
  }
}
export function resolveArtifactsRoot(): string {
  const envPath = process.env.RADAR_GEO_ARTIFACTS_DIR;
  if (envPath) {
    const absolute = path.isAbsolute(envPath) ? envPath : path.resolve(process.cwd(), envPath);
    if (fs.existsSync(absolute)) {
      return absolute;
    }
  }

  const candidates = [
    path.resolve(process.cwd(), "data/geo/artifacts"),
    path.resolve(process.cwd(), "../../data/geo/artifacts"),
    path.resolve(process.cwd(), "../../../data/geo/artifacts"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("Geo artifacts directory not found. Set RADAR_GEO_ARTIFACTS_DIR.");
}

