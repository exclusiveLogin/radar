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

function buildAliases(name: string, nameWithType?: string): string[] {
  const values = [name, nameWithType].filter(Boolean) as string[];
  const aliases = new Set<string>();

  for (const value of values) {
    const normalized = normalize(value);
    aliases.add(normalized);
    aliases.add(
      normalized
        .replace(
          /(?:^|\s)(обл|область|респ|республика|край|ао|автономный округ)(?=\s|$)/g,
          " ",
        )
        .replace(/\s+/g, " ")
        .trim(),
    );
  }

  return [...aliases].filter(Boolean);
}

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

  findRegionInText(rawText: string): RegionCatalogEntry | null {
    const haystack = ` ${normalize(rawText)} `;

    const sorted = [...this.entries].sort((a, b) => {
      const aLen = Math.max(...a.aliases.map((x) => x.length), 0);
      const bLen = Math.max(...b.aliases.map((x) => x.length), 0);
      return bLen - aLen;
    });

    for (const entry of sorted) {
      for (const alias of entry.aliases) {
        if (!alias) continue;
        if (haystack.includes(` ${alias} `)) {
          return entry;
        }
      }
    }

    return null;
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

