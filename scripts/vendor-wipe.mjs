#!/usr/bin/env node
/**
 * vendor:wipe — снос кэша OSM-клона (data/geo/vendor).
 * БД и data/geo/artifacts (снапшот для geo:catalog:import) по умолчанию не трогает.
 *
 * Для полного reset БД — parse-engine:system:wipe / vendor-ingest-parse-geo:wipe.
 */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./utils.mjs";

const args = new Set(process.argv.slice(2).map((a) => a.toLowerCase()));
const dryRun = args.has("--dry-run") || args.has("--dry");
const withArtifacts = args.has("--with-artifacts");
const help = args.has("--help") || args.has("-h");

if (help) {
  console.log(`
vendor:wipe — снос кэша OSM-клона (по умолчанию только vendor/)

  npm run vendor:wipe -- [--dry-run]
  npm run vendor:wipe -- --with-artifacts [--dry-run]

По умолчанию удаляет:
  data/geo/vendor          — shallow clone OSM (восстановить: npm run geo:vendor)

С --with-artifacts (явно, ломает идемпотентный rebuild без geo:sync):
  data/geo/artifacts       — снапшот границ; нужен для geo:catalog:import шаг osm

Не трогает:
  data/geo/catalog, data/geo/dictionaries
`);
  process.exit(0);
}

const targets = [join(repoRoot, "data", "geo", "vendor")];
if (withArtifacts) {
  targets.push(join(repoRoot, "data", "geo", "artifacts"));
  console.log(
    "\x1b[33m[warn] --with-artifacts: после wipe нужны geo:vendor + geo:sync перед geo:catalog:import\x1b[0m",
  );
}

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
