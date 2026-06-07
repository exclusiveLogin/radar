import * as fs from "node:fs";
import { repoDataPath } from "../monorepo-root";

/** Загружает смежность регионов из data/geo/dictionaries/adjacency.json (ISO → соседние ISO). */
export function loadRegionAdjacency(): Record<string, string[]> {
  const file = repoDataPath("geo", "dictionaries", "adjacency.json");
  if (!fs.existsSync(file)) return {};
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
    adjacency?: Record<string, string[]>;
  };
  return parsed.adjacency ?? {};
}
