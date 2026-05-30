import * as fs from "node:fs";
import * as path from "node:path";
import { MONOREPO_ROOT } from "@repo/root";

/** Читает смежность регионов (ISO -> соседи) из data/geo/dictionaries/adjacency.json. */
export function loadRegionAdjacency(): Record<string, string[]> {
  const file = path.join(
    MONOREPO_ROOT,
    "data",
    "geo",
    "dictionaries",
    "adjacency.json",
  );
  if (!fs.existsSync(file)) return {};
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
    adjacency?: Record<string, string[]>;
  };
  return parsed.adjacency ?? {};
}
