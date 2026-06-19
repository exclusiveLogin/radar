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
  const masc = alias.match(/^(.+)(ский)$/);
  if (masc?.[1]) {
    const stem = masc[1];
    out.add(`${stem}ского`);
    out.add(`${stem}скому`);
    out.add(`${stem}ским`);
  }
  const neut = alias.match(/^(.+)(ское)$/);
  if (neut?.[1]) {
    const stem = neut[1];
    out.add(`${stem}ского`);
  }
  return [...out];
}

/** Падежи типа субъекта: область → области, областей … */
function expandSubjectTypeToken(typeToken: string): string[] {
  const normalized = normalize(typeToken);
  const forms: Record<string, string[]> = {
    область: ["области", "областей", "обл"],
    обл: ["области", "областей", "область"],
    край: ["края", "краю", "краем", "краёв"],
    республика: ["республики", "республик", "респ"],
    респ: ["республики", "республик", "республика"],
    округ: ["округа", "округов"],
    ао: ["ао", "округа", "округов"],
  };
  return forms[normalized] ?? [];
}

/** Полные фразы «прилагательное + тип» в типичных падежах. */
function expandRegionalPhraseForms(nameWithType: string): string[] {
  const normalized = normalize(nameWithType);
  const match = normalized.match(/^(.+?)\s+(область|обл|край|республика|респ|округ|ао)$/);
  if (!match?.[1] || !match[2]) return [];

  const adjective = match[1].trim();
  const typeToken = match[2].trim();
  const adjectiveForms = expandRegionalAdjectiveForms(adjective);
  const typeForms = [typeToken, ...expandSubjectTypeToken(typeToken)];
  const phrases = new Set<string>();

  for (const adj of adjectiveForms) {
    for (const type of typeForms) {
      phrases.add(`${adj} ${type}`.trim());
    }
  }
  return [...phrases];
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
    for (const typeForm of expandSubjectTypeToken(a)) {
      expanded.add(typeForm);
    }
  }
  if (nameWithType) {
    for (const phrase of expandRegionalPhraseForms(nameWithType)) {
      expanded.add(phrase);
    }
  }
  return [...expanded].filter(Boolean);
}

type RegionMatch = {
  entry: RegionCatalogEntry;
  index: number;
  aliasLength: number;
};

/** Доп. текстовые алиасы субъектов (ЛНР/ДНР и т.п.). */
const EXTRA_REGION_TEXT_ALIASES: Record<string, string[]> = {
  "RU-LUG": ["лнр", "луганская народная республика"],
  "RU-DON": ["днр", "донецкая народная республика"],
};

export class RegionCatalog {
  private readonly entries: RegionCatalogEntry[];

  private constructor(entries: RegionCatalogEntry[]) {
    this.entries = entries;
  }

  /** Пустой каталог для maintenance CLI без артефактов на диске. */
  static empty(): RegionCatalog {
    return new RegionCatalog([]);
  }

  /** SSOT регионов: data/geo/catalog/regions.json (после выпила hflabs). */
  static loadFromCatalogJson(jsonPath: string): RegionCatalog {
    const source = fs.readFileSync(jsonPath, "utf8").replace(/^\uFEFF/, "");
    const rows = JSON.parse(source) as Array<{
      iso?: string;
      name?: string;
      nameWithType?: string;
      shortName?: string;
      federalDistrict?: string;
      fiasId?: string | null;
    }>;

    const entries: RegionCatalogEntry[] = rows
      .filter((row) => row.iso && row.name)
      .map((row) => {
        const fullName = row.nameWithType?.trim() || row.name!.trim();
        const aliases = new Set(buildAliases(row.name!, row.nameWithType));
        if (row.shortName) {
          for (const a of buildAliases(row.shortName, undefined)) {
            aliases.add(a);
          }
        }
        return {
          code: row.iso!,
          name: fullName,
          fiasId: row.fiasId ?? undefined,
          federalDistrict: row.federalDistrict,
          aliases: [...aliases],
        };
      })
      .map((entry) => {
        const extra = EXTRA_REGION_TEXT_ALIASES[entry.code] ?? [];
        if (extra.length === 0) {
          return entry;
        }
        const merged = new Set(entry.aliases);
        for (const alias of extra) {
          merged.add(normalize(alias));
        }
        return { ...entry, aliases: [...merged] };
      });

    return new RegionCatalog(entries);
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

