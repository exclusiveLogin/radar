import * as fs from "node:fs";
import type { LayoutTile } from "@radar/shared";
import { repoDataPath } from "../monorepo-root";

type LayoutFile = {
  cols?: number;
  rows?: number;
  tiles?: Record<string, LayoutTile>;
};

/** Загружает тайл-грид схемы из data/geo/dictionaries/layout.json (по ISO региона). */
export function loadLayout(): {
  cols: number;
  rows: number;
  tiles: Record<string, LayoutTile>;
} {
  const file = repoDataPath("geo", "dictionaries", "layout.json");
  if (!fs.existsSync(file)) {
    return { cols: 0, rows: 0, tiles: {} };
  }
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as LayoutFile;
  return {
    cols: parsed.cols ?? 0,
    rows: parsed.rows ?? 0,
    tiles: parsed.tiles ?? {},
  };
}
