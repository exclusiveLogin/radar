/**
 * Центроиды всех субъектов РФ: hflabs ISO + OSM Russia_regions.geojson (fuzzy по имени).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

const STOP = new Set([
  "респ",
  "республика",
  "обл",
  "область",
  "край",
  "округ",
  "автономный",
  "ао",
  "город",
  "г",
  "федерального",
  "значения",
  "югра",
  "кузбасс",
  "адыгея",
  "татарстан",
  "алания",
  "чувашия",
]);

/** Вне OSM-85: новые субъекты. */
const MANUAL = [
  { iso: "RU-DON", lat: 48.0159, lon: 37.8029 },
  { iso: "RU-LUG", lat: 48.574, lon: 39.3078 },
  { iso: "RU-ZP", lat: 46.8489, lon: 35.365 },
  { iso: "RU-KHE", lat: 46.1745, lon: 34.8094 },
  { iso: "RU-AD", lat: 44.609, lon: 40.1 },
  { iso: "RU-TA", lat: 55.788, lon: 49.122 },
];

const GEO_NAME_TO_ISO = {
  "г москва": "RU-MOW",
  "г санкт петербург": "RU-SPE",
  "республика крым": "RU-CR",
  "город федерального значения севастополь": "RU-SEV",
};

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

function normName(s) {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim();
}

function tokens(s) {
  return normName(s)
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

function nameMatch(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  let hits = 0;
  for (const t of ta) {
    if (tb.some((u) => u === t || u.includes(t) || t.includes(u))) hits += 1;
  }
  const need = Math.max(1, Math.min(ta.length, tb.length) - 1);
  return hits >= need;
}

function ringCentroid(ring) {
  let lat = 0;
  let lon = 0;
  let n = 0;
  for (const [x, y] of ring) {
    lon += x;
    lat += y;
    n += 1;
  }
  return n ? { lon: lon / n, lat: lat / n } : null;
}

function featureCentroid(geom) {
  if (!geom) return null;
  if (geom.type === "Polygon") return ringCentroid(geom.coordinates[0]);
  if (geom.type === "MultiPolygon") {
    let best = null;
    let bestN = 0;
    for (const poly of geom.coordinates) {
      const c = ringCentroid(poly[0]);
      const n = poly[0]?.length ?? 0;
      if (c && n > bestN) {
        best = c;
        bestN = n;
      }
    }
    return best;
  }
  return null;
}

function loadHflabsRows() {
  const file = path.join(
    root,
    "data/geo/artifacts/reference/hflabs-region/region.csv",
  );
  const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
  const header = parseCsvLine(lines[0]);
  const isoIdx = header.indexOf("iso_code");
  const nameIdx = header.indexOf("name");
  const nwtIdx = header.indexOf("name_with_type");

  const rows = [];
  for (const line of lines.slice(1)) {
    const parts = parseCsvLine(line);
    const iso = parts[isoIdx]?.trim();
    if (!iso?.startsWith("RU-")) continue;
    rows.push({
      iso,
      labels: [parts[nameIdx], parts[nwtIdx]].filter(Boolean),
    });
  }
  return rows;
}

function main() {
  const hflabs = loadHflabsRows();
  const geoPath = path.join(
    root,
    "data/geo/artifacts/boundaries/Russia_geojson_OSM",
    "GeoJson's",
    "Countries",
    "Russia_regions.geojson",
  );
  const geo = JSON.parse(fs.readFileSync(geoPath, "utf8"));

  const geoFeatures = geo.features.map((f) => ({
    region: String(f.properties?.region ?? ""),
    centroid: featureCentroid(f.geometry),
  }));

  const byIso = new Map(MANUAL.map((r) => [r.iso, r]));
  const unmatched = [];

  for (const row of hflabs) {
    if (byIso.has(row.iso)) continue;

    let found = null;
    for (const g of geoFeatures) {
      const key = normName(g.region);
      if (GEO_NAME_TO_ISO[key] === row.iso) {
        found = g;
        break;
      }
      if (row.labels.some((label) => nameMatch(label, g.region))) {
        found = g;
        break;
      }
    }
    if (found?.centroid) {
      byIso.set(row.iso, { iso: row.iso, ...found.centroid });
    } else {
      unmatched.push(row.iso);
    }
  }

  for (const g of geoFeatures) {
    const key = normName(g.region);
    const iso = GEO_NAME_TO_ISO[key];
    if (iso && g.centroid && !byIso.has(iso)) {
      byIso.set(iso, { iso, ...g.centroid });
    }
  }

  const out = [...byIso.values()].sort((a, b) => a.iso.localeCompare(b.iso));
  const outPath = path.join(root, "scripts/geo/rf-region-centroids.json");
  fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  console.log(`centroids: ${out.length} (unmatched: ${unmatched.length})`);
  if (unmatched.length) console.warn(unmatched.join(", "));
}

main();
