#!/usr/bin/env node
/**
 * Полный reset: wipe БД (raw + операционка + geo-каталог) → geo:init.
 *
 *   npm run system:reset -- --confirm
 *   npm run system:reset -- --confirm --wipe-only   # без geo:init
 *
 * Перед запуском остановите dev/worker (иначе снова наполнит очереди).
 */
import { run } from "./utils.mjs";

const args = process.argv.slice(2);
const confirm = args.includes("--confirm");
const wipeOnly = args.includes("--wipe-only");
const help = args.includes("--help") || args.includes("-h");

if (help) {
  console.log(`
system:reset — wipe + раскатка geo с нуля

  npm run system:reset -- --confirm
  npm run system:reset -- --confirm --wipe-only

Шаги (без --wipe-only):
  1. parse-engine:system:wipe  — raw, parsed, places, regions, geo_feature, …
  2. geo:init                  — regions:seed → vendor → sync → seed → features:import

После reset при необходимости:
  npm run parse-engine:rebuild:drain
`);
  process.exit(0);
}

if (!confirm) {
  console.error("\x1b[31mНужен флаг --confirm. Пример: npm run system:reset -- --confirm\x1b[0m");
  process.exit(1);
}

function runNpm(scriptArgs) {
  if (process.platform === "win32") {
    run("cmd", ["/c", "npm", "run", ...scriptArgs]);
    return;
  }
  run("npm", ["run", ...scriptArgs]);
}

console.log("\n\x1b[36m=== system:reset (full wipe) ===\x1b[0m");

console.log("\n\x1b[33m[1] vendor:wipe (диск, опционально)\x1b[0m");
runNpm(["vendor:wipe"]);

console.log("\n\x1b[33m[2] vendor-ingest-parse-geo:wipe (БД)\x1b[0m");
process.env.RADAR_CONFIRM_SYSTEM_WIPE = "1";
runNpm(["vendor-ingest-parse-geo:wipe"]);

if (!wipeOnly) {
  console.log("\n\x1b[33m[3] geo:init (regions → vendor → sync → seed → features)\x1b[0m");
  runNpm(["geo:init"]);
}

console.log("\n\x1b[32msystem:reset completed\x1b[0m");
if (!wipeOnly) {
  console.log(
    "\x1b[90mОпционально: npm run parse-engine:rebuild:drain — перепарс raw после появления ingest\x1b[0m",
  );
}
