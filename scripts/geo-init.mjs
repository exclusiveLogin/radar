#!/usr/bin/env node
/**
 * Полная инициализация гео-данных с нуля.
 *
 *  1. geo:regions:seed   — регионы + place(kind=region) из catalog/regions.json
 *  2. geo:vendor         — клонировать OSM GeoJSON репозиторий
 *  3. geo:sync           — синхронизировать артефакты + manifest.json
 *  4. geo:seed           — реестр файлов geo_dataset_file (для трекинга)
 *  5. geo:features:import — OSM → geo_feature + catalog places + place_geo_link
 */
import { run } from "./utils.mjs";

const STEPS = [
  ["seed regions catalog",    ["geo:regions:seed"]],
  ["vendor clone (OSM)",      ["geo:vendor"]],
  ["sync artifacts",          ["geo:sync"]],
  ["seed geo_dataset_file",   ["geo:seed"]],
  ["import geo features",     ["geo:features:import"]],
];

function runNpm(args) {
  if (process.platform === "win32") {
    run("cmd", ["/c", "npm", "run", ...args]);
    return;
  }
  run("npm", ["run", ...args]);
}

async function main() {
  for (const [i, [title, args]] of STEPS.entries()) {
    console.log(`\n\x1b[36m[geo:init ${i + 1}/${STEPS.length}] ${title}\x1b[0m`);
    runNpm(args);
  }
  console.log("\n\x1b[32mgeo:init completed\x1b[0m");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
