#!/usr/bin/env node
/**
 * Полный reset БД (+ опционально legacy geo:init).
 *
 *   npm run system:reset -- --confirm
 *   npm run system:reset -- --confirm --wipe-only
 *
 * Актуальный трек без legacy geo:init:
 *   parse-engine:system:wipe → geo:catalog:import → backfill → rebuild:drain
 *   (см. docs/runbook/geo-clean-rebuild.md)
 *
 * Перед запуском остановите dev/worker.
 */
import { run } from "./utils.mjs";

const args = process.argv.slice(2);
const confirm = args.includes("--confirm");
const wipeOnly = args.includes("--wipe-only");
const help = args.includes("--help") || args.includes("-h");

if (help) {
  console.log(`
system:reset — wipe БД (+ опционально legacy geo:init)

  npm run system:reset -- --confirm
  npm run system:reset -- --confirm --wipe-only

Шаги:
  1. vendor-ingest-parse-geo:wipe — raw, parsed, places, regions, geo_feature, …
  2. geo:init (legacy) — только без --wipe-only

Диск (data/geo/artifacts, catalog) не трогает.
Для свежего OSM-клона вручную: npm run vendor:wipe

Рекомендуемый трек после --wipe-only:
  npm run geo:catalog:import -w @radar/api
  npm run parse-engine:ingest:backfill -w @radar/worker
  npm run parse-engine:rebuild:drain -w @radar/worker
`);
  process.exit(0);
}

if (!confirm) {
  console.error("\n\x1b[31mНужен флаг --confirm. Пример: npm run system:reset -- --confirm\x1b[0m");
  process.exit(1);
}

function runNpm(scriptArgs) {
  if (process.platform === "win32") {
    run("cmd", ["/c", "npm", "run", ...scriptArgs]);
    return;
  }
  run("npm", ["run", ...scriptArgs]);
}

console.log("\n\x1b[36m=== system:reset (DB wipe) ===\x1b[0m");

console.log("\n\x1b[33m[1] vendor-ingest-parse-geo:wipe (БД)\x1b[0m");
process.env.RADAR_CONFIRM_SYSTEM_WIPE = "1";
runNpm(["vendor-ingest-parse-geo:wipe"]);

if (!wipeOnly) {
  console.log("\n\x1b[33m[2] geo:init (legacy: regions → vendor → sync → features)\x1b[0m");
  runNpm(["geo:init"]);
}

console.log("\n\x1b[32msystem:reset completed\x1b[0m");
if (wipeOnly) {
  console.log(
    "\x1b[90mДальше: geo:catalog:import → ingest:backfill → rebuild:drain (runbook/geo-clean-rebuild.md)\x1b[0m",
  );
} else {
  console.log(
    "\x1b[90mLegacy geo:init выполнен. Для catalog SSOT предпочтительнее: geo:catalog:import\x1b[0m",
  );
}
