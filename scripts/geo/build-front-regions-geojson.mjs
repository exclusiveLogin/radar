/**
 * Контуры ДНР/ЛНР/Запорожье/Херсон из ukrainian_geodata (области UA, 2020).
 * Источник: https://github.com/slawomirmatuszak/ukrainian_geodata (regiony.geojson)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

const SOURCE_URL =
  "https://raw.githubusercontent.com/slawomirmatuszak/ukrainian_geodata/main/regiony.geojson";

const UA_TO_RU = [
  {
    match: "Донецька",
    iso: "RU-DON",
    label: "Донецкая народная Республика",
  },
  {
    match: "Луганська",
    iso: "RU-LUG",
    label: "Луганская народная Республика",
  },
  {
    match: "Запорізька",
    iso: "RU-ZP",
    label: "Запорожская область",
  },
  {
    match: "Херсонська",
    iso: "RU-KHE",
    label: "Херсонская область",
  },
];

const outDir = path.join(root, "data/geo/artifacts/boundaries/supplemental");
const sourcePath = path.join(outDir, "ukraine-regiony.source.geojson");
const outPath = path.join(outDir, "front-regions.geojson");

async function ensureSource() {
  if (fs.existsSync(sourcePath) && fs.statSync(sourcePath).size > 10_000) {
    return;
  }
  fs.mkdirSync(outDir, { recursive: true });
  const res = await fetch(SOURCE_URL);
  if (!res.ok) {
    throw new Error(`fetch ${SOURCE_URL}: ${res.status}`);
  }
  fs.writeFileSync(sourcePath, Buffer.from(await res.arrayBuffer()));
}

function main() {
  void ensureSource().then(() => {
    const raw = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
    const features = [];

    for (const feature of raw.features ?? []) {
      const uaName = String(feature.properties?.region ?? "");
      const rule = UA_TO_RU.find((row) => uaName.includes(row.match));
      if (!rule) continue;
      if (!feature.geometry?.type || !feature.geometry.coordinates) continue;

      features.push({
        type: "Feature",
        properties: {
          region: rule.label,
          regionCode: rule.iso,
        },
        geometry: feature.geometry,
      });
    }

    if (features.length !== UA_TO_RU.length) {
      throw new Error(
        `expected ${UA_TO_RU.length} front regions, got ${features.length}`,
      );
    }

    const collection = {
      type: "FeatureCollection",
      features,
    };
    fs.writeFileSync(outPath, `${JSON.stringify(collection)}\n`, "utf8");
    console.log(`wrote ${outPath} (${features.length} features)`);
  });
}

main();
