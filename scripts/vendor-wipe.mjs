#!/usr/bin/env node
/**
 * vendor:wipe — удаляет артефакты на диске (data/geo/artifacts, data/geo/vendor).
 * БД не трогает. Для полного reset БД — vendor-ingest-parse-geo:wipe.
 */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./utils.mjs";

const args = new Set(process.argv.slice(2).map((a) => a.toLowerCase()));
const dryRun = args.has("--dry-run") || args.has("--dry");
const help = args.has("--help") || args.has("-h");

if (help) {
  console.log(`
vendor:wipe — снос кэша OSM на диске

  npm run vendor:wipe -- [--dry-run]

Удаляет:
  data/geo/artifacts
  data/geo/vendor
`);
  process.exit(0);
}

const targets = [
  join(repoRoot, "data", "geo", "artifacts"),
  join(repoRoot, "data", "geo", "vendor"),
];

for (const path of targets) {
  if (!existsSync(path)) {
    console.log(`[skip] нет каталога: ${path}`);
    continue;
  }
  if (dryRun) {
    console.log(`[dry-run] удалил бы: ${path}`);
    continue;
  }
  rmSync(path, { recursive: true, force: true });
  console.log(`[removed] ${path}`);
}

console.log(dryRun ? "\n[dry-run] vendor:wipe не выполнялся." : "\nvendor:wipe done");
