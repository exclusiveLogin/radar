import * as fs from "node:fs";
import { repoDataPath } from "../../monorepo-root";

type CatalogLayer = "tabular" | "frontline" | "boundaries" | "relations";

const LEGACY_PATHS: Record<CatalogLayer, (name: string) => string[]> = {
  tabular: (name) => [
    repoDataPath("geo", "catalog", name),
  ],
  frontline: (name) => [
    repoDataPath("geo", "dictionaries", name),
    repoDataPath("geo", "artifacts", "boundaries", "supplemental", name),
  ],
  boundaries: (name) => [
    repoDataPath("geo", "artifacts", "boundaries", name),
  ],
  relations: (name) => [
    repoDataPath("geo", "dictionaries", name),
  ],
};

/**
 * Путь к артефакту geo catalog: приоритет `data/geo/catalog/<layer>/`,
 * затем legacy (`catalog/`, `dictionaries/`, `artifacts/`).
 */
export function resolveGeoCatalogPath(layer: CatalogLayer, fileName: string): string {
  const structured = repoDataPath("geo", "catalog", layer, fileName);
  if (fs.existsSync(structured)) {
    return structured;
  }

  for (const candidate of LEGACY_PATHS[layer](fileName)) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return structured;
}
