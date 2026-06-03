#!/usr/bin/env node
/**
 * Обновление гео-данных (OSM уже склонирован).
 *
 *  1. geo:regions:seed   — идемпотентно; подхватывает правки в catalog/regions.json
 *  2. geo:vendor:pull    — git pull OSM репозитория
 *  3. geo:sync           — пересинхронизировать артефакты + manifest.json
 *  4. geo:seed           — обновить реестр geo_dataset_file
 *  5. geo:features:import — idempotent upsert geo_feature + catalog places
 */
import { run } from "./utils.mjs";

const STEPS = [
  ["seed regions catalog",    ["geo:regions:seed"]],
  ["vendor pull (OSM)",       ["geo:vendor:pull"]],
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
    console.log(`\n\x1b[36m[geo:update ${i + 1}/${STEPS.length}] ${title}\x1b[0m`);
    runNpm(args);
  }
  console.log("\n\x1b[32mgeo:update completed\x1b[0m");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
