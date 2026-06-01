/**
 * Генерация layout.json: все субъекты РФ (ISO RU-*) + Крым/Севастополь/Донбасс.
 * col → восток, row → юг. Сохраняет ручные позиции из текущего layout.json.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

const BBOX = { minLon: 19, maxLon: 169, minLat: 41, maxLat: 76 };
const GRID_COLS = 28;
const GRID_ROWS = 18;


function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQ = !inQ;
      continue;
    }
    if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function loadHflabsCentroids() {
  const file = path.join(
    root,
    "data/geo/artifacts/reference/hflabs-region/region.csv",
  );
  const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
  const header = parseCsvLine(lines[0]);
  const isoIdx = header.indexOf("iso_code");
  const nameIdx = header.indexOf("name");
  const map = new Map();

  for (const line of lines.slice(1)) {
    const parts = parseCsvLine(line);
    const iso = parts[isoIdx]?.trim();
    if (!iso?.startsWith("RU-")) continue;
    const name = parts[nameIdx]?.trim() ?? iso;
    map.set(iso, { iso, name, lat: null, lon: null });
  }
  return map;
}

/** Приближённые центроиды по имени (hflabs без lat/lon) — из открытых справочников. */
function loadCentroidTable() {
  const file = path.join(root, "scripts/geo/rf-region-centroids.json");
  if (!fs.existsSync(file)) return new Map();
  const rows = JSON.parse(fs.readFileSync(file, "utf8"));
  return new Map(rows.map((r) => [r.iso, r]));
}

function lonLatToTile(lon, lat) {
  const col = Math.round(
    ((lon - BBOX.minLon) / (BBOX.maxLon - BBOX.minLon)) * (GRID_COLS - 1),
  );
  const row = Math.round(
    ((BBOX.maxLat - lat) / (BBOX.maxLat - BBOX.minLat)) * (GRID_ROWS - 1),
  );
  return {
    col: Math.max(0, Math.min(GRID_COLS - 1, col)),
    row: Math.max(0, Math.min(GRID_ROWS - 1, row)),
  };
}

function resolveCollisions(tiles) {
  const used = new Map();
  const out = {};

  const sorted = Object.entries(tiles).sort(([a], [b]) => a.localeCompare(b));

  for (const [iso, tile] of sorted) {
    let { col, row } = tile;
    let key = `${col},${row}`;
    let guard = 0;
    while (used.has(key) && guard < 500) {
      col += 1;
      if (col >= GRID_COLS) {
        col = 0;
        row += 1;
      }
      if (row >= GRID_ROWS) row = GRID_ROWS - 1;
      key = `${col},${row}`;
      guard += 1;
    }
    used.set(key, iso);
    out[iso] = { col, row };
  }
  return out;
}

function main() {
  const layoutPath = path.join(root, "data/geo/dictionaries/layout.json");
  const existing = JSON.parse(fs.readFileSync(layoutPath, "utf8"));
  const preserved = existing.tiles ?? {};

  const byIso = loadHflabsCentroids();
  const centroids = loadCentroidTable();

  for (const [iso, c] of centroids) {
    if (!byIso.has(iso)) byIso.set(iso, { iso, name: iso, ...c });
    else {
      const row = byIso.get(iso);
      if (row.lat == null && c.lat != null) {
        row.lat = c.lat;
        row.lon = c.lon;
      }
    }
  }

  const draftTiles = {};
  for (const [iso, row] of byIso) {
    if (preserved[iso]) {
      draftTiles[iso] = preserved[iso];
      continue;
    }
    const c = centroids.get(iso);
    if (!c?.lat || !c?.lon) {
      console.warn(`skip ${iso}: no centroid`);
      continue;
    }
    draftTiles[iso] = lonLatToTile(c.lon, c.lat);
  }

  const tiles = resolveCollisions(draftTiles);
  let maxCol = 0;
  let maxRow = 0;
  for (const t of Object.values(tiles)) {
    maxCol = Math.max(maxCol, t.col);
    maxRow = Math.max(maxRow, t.row);
  }

  const layout = {
    version: 1,
    note:
      "Тайл-грид субъектов РФ (ISO 3166-2:RU) для SchematicMapWidget. col — восток, row — юг. "
      + "Полный перечень: hflabs region.csv + RU-DON/LUG/ZP/KHE/CR/SEV. "
      + "Ручные позиции европейской части сохранены; остальное — по центроидам.",
    cols: maxCol + 1,
    rows: maxRow + 1,
    tiles,
  };

  fs.writeFileSync(layoutPath, `${JSON.stringify(layout, null, 2)}\n`, "utf8");
  console.log(`layout.json: ${Object.keys(tiles).length} tiles, ${layout.cols}x${layout.rows}`);
}

main();
