import * as fs from "node:fs";
import * as path from "node:path";

export type CityCatalogEntry = {
  name: string;
  aliases: string[];
  lat?: number;
  lon?: number;
};

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/["'`]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNameFromFilename(fileName: string): string {
  const base = fileName.replace(/\.geojson$/i, "");
  const [cyrillic] = base.split("_");
  return cyrillic ?? base;
}

function collectFirstCoordinate(value: unknown): [number, number] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  if (
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  ) {
    return [value[0], value[1]];
  }

  for (const item of value) {
    const nested = collectFirstCoordinate(item);
    if (nested) {
      return nested;
    }
  }

  return null;
}

export class CityCatalog {
  private readonly entries: CityCatalogEntry[];

  private constructor(entries: CityCatalogEntry[]) {
    this.entries = entries;
  }

  static loadFromDirectory(dirPath: string): CityCatalog {
    const entries: CityCatalogEntry[] = [];
    const files = fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".geojson"));

    for (const file of files) {
      const fullPath = path.join(dirPath, file.name);
      const raw = fs.readFileSync(fullPath, "utf8");
      const parsed = JSON.parse(raw) as {
        features?: Array<{ geometry?: { coordinates?: unknown } }>;
      };
      const firstCoordinates = collectFirstCoordinate(
        parsed.features?.[0]?.geometry?.coordinates,
      );

      const name = parseNameFromFilename(file.name);
      entries.push({
        name,
        aliases: [normalize(name)],
        lon: firstCoordinates?.[0],
        lat: firstCoordinates?.[1],
      });
    }

    return new CityCatalog(entries);
  }

  findInText(rawText: string): CityCatalogEntry[] {
    // Replace punctuation with spaces so "Тольятти," or "Тольятти." still match.
    const haystack = ` ${normalize(rawText).replace(/[,;:.!?()\[\]]/g, " ").replace(/\s+/g, " ")} `;
    const matches = this.entries.filter((entry) =>
      entry.aliases.some((alias) => haystack.includes(` ${alias} `)),
    );

    const unique = new Map<string, CityCatalogEntry>();
    for (const match of matches) {
      unique.set(match.name.toLowerCase(), match);
    }

    return [...unique.values()];
  }

  list(): CityCatalogEntry[] {
    return this.entries;
  }
}
