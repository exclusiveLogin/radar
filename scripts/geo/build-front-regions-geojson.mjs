/**
 * Контуры ДНР/ЛНР/Запорожье/Херсон из ukrainian_geodata (области UA, 2020).
 * Источник: https://github.com/slawomirmatuszak/ukrainian_geodata (regiony.geojson)
 *
 * Выход: data/geo/artifacts/boundaries/supplemental/front-regions.geojson
 * Импортируется OsmRussiaGeoImporter на шаге osm_geometry (geo catalog:import).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SOURCE_URL =
  "https://raw.githubusercontent.com/slawomirmatuszak/ukrainian_geodata/main/regiony.geojson";

/** Маппинг UA-областей → ISO из catalog/regions.json. */
export const UA_TO_RU = [
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

/**
 * Собирает FeatureCollection из сырого regiony.geojson.
 * @param {unknown} raw
 */
export function buildFrontRegionFeatures(raw) {
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

  return features;
}

/**
 * Путь к regiony.geojson: vendor clone → fallback fetch в artifacts.
 * @param {{ vendorRoot: string; cachePath: string }} input
 */
async function resolveSourceGeoJson(input) {
  const vendorPath = path.join(input.vendorRoot, "ukrainian_geodata", "regiony.geojson");
  if (fs.existsSync(vendorPath) && fs.statSync(vendorPath).size > 10_000) {
    return vendorPath;
  }

  if (fs.existsSync(input.cachePath) && fs.statSync(input.cachePath).size > 10_000) {
    return input.cachePath;
  }

  fs.mkdirSync(path.dirname(input.cachePath), { recursive: true });
  const res = await fetch(SOURCE_URL);
  if (!res.ok) {
    throw new Error(`fetch ${SOURCE_URL}: ${res.status}`);
  }
  fs.writeFileSync(input.cachePath, Buffer.from(await res.arrayBuffer()));
  return input.cachePath;
}

/**
 * Строит front-regions.geojson в artifacts/supplemental.
 * @param {{ root?: string; vendorRoot?: string; outDir?: string }} [options]
 */
export async function runBuild(options = {}) {
  const root = options.root ?? path.resolve(__dirname, "../..");
  const vendorRoot = options.vendorRoot ?? path.join(root, "data/geo/vendor");
  const outDir =
    options.outDir ?? path.join(root, "data/geo/artifacts/boundaries/supplemental");
  const cachePath = path.join(outDir, "ukraine-regiony.source.geojson");
  const outPath = path.join(outDir, "front-regions.geojson");

  const sourcePath = await resolveSourceGeoJson({ vendorRoot, cachePath });
  const raw = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const features = buildFrontRegionFeatures(raw);

  fs.mkdirSync(outDir, { recursive: true });
  const collection = { type: "FeatureCollection", features };
  fs.writeFileSync(outPath, `${JSON.stringify(collection)}\n`, "utf8");

  return {
    outPath,
    sourcePath,
    featureCount: features.length,
  };
}

async function main() {
  const result = await runBuild();
  console.log(`wrote ${result.outPath} (${result.featureCount} features)`);
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (entry && import.meta.url === entry) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
