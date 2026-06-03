import * as fs from "node:fs";
import * as path from "node:path";
import { MONOREPO_ROOT } from "@repo/root";
import type { LocalityAnchor } from "../../domain/geo/geographicTextContext.js";

type PlaceDictionaryRow = {
  regionCode: string;
  kind?: string;
  name: string;
  aliases?: string[];
};

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Справочник якорных населённых пунктов (data/geo/dictionaries/places.json).
 * Используется для привязки «микрорайон + город» к региону города, а не к одному прилагательному.
 */
export class KnownLocalityCatalog {
  private readonly anchors: LocalityAnchor[];

  private constructor(anchors: LocalityAnchor[]) {
    this.anchors = anchors;
  }

  static empty(): KnownLocalityCatalog {
    return new KnownLocalityCatalog([]);
  }

  static loadFromDictionaries(
    root = path.join(MONOREPO_ROOT, "data", "geo", "dictionaries"),
  ): KnownLocalityCatalog {
    const file = path.join(root, "places.json");
    if (!fs.existsSync(file)) {
      return new KnownLocalityCatalog([]);
    }

    const rows = JSON.parse(fs.readFileSync(file, "utf8")) as PlaceDictionaryRow[];
    const byKey = new Map<string, LocalityAnchor>();

    for (const row of rows) {
      if (!row.regionCode || !row.name) {
        continue;
      }
      const kind =
        row.kind === "city" || row.kind === "locality" || row.kind === "settlement"
          ? row.kind
          : "city";
      const names = [row.name, ...(row.aliases ?? [])];
      for (const name of names) {
        const key = normalize(name);
        if (!key) {
          continue;
        }
        byKey.set(key, {
          name: row.name,
          regionCode: row.regionCode,
          kind,
        });
      }
    }

    return new KnownLocalityCatalog([...byKey.values()]);
  }

  /** Все якоря (для поиска по тексту). */
  list(): LocalityAnchor[] {
    return this.anchors;
  }
}
