import { MONOREPO_ROOT } from "@repo/root";
import { purgeGarbageCatalogPlaces } from "../application/parse/placeCatalogHealer.js";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { cliWorkerRuntime } from "./cliWorkerRuntime.js";
import { hasAnyFlag, parseLongFlagsMap } from "./workerCliArgs.js";

/** Снять с каталога places с мусорными именами (канал, футер, не топоним). */
async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const flags = parseLongFlagsMap(process.argv);
  const dryRun = hasAnyFlag(flags, ["dry-run", "dryRun"]);

  if (hasAnyFlag(flags, ["help", "h"])) {
    console.log(`Usage: npm run parse-engine:catalog:purge-garbage [--dry-run]

  Деактивирует places с isGarbageIngestPlaceName (is_active=false, trust=rejected).
  Удаляет job_geo_place_enrich для них.`);
    process.exit(0);
  }

  const runtime = await createWorkerCompositionRoot(cliWorkerRuntime("geo", ["geo"]));
  if (!runtime.dataSource || !runtime.workerRepos) {
    console.error("catalog:purge-garbage: нужен RADAR_STORAGE_MODE=db");
    process.exit(1);
  }

  const places = await runtime.workerRepos.places.listActive();
  const summary = await purgeGarbageCatalogPlaces({
    dataSource: runtime.dataSource,
    places,
    dryRun,
  });

  console.log(
    `catalog:purge-garbage dryRun=${dryRun} scanned=${summary.scanned} purged=${summary.purged}`,
  );
  for (const row of summary.rows.slice(0, 50)) {
    console.log(`  deprecated ${row.placeName.slice(0, 72)} (${row.placeId.slice(0, 8)})`);
  }
  if (summary.rows.length > 50) {
    console.log(`  ... ещё ${summary.rows.length - 50}`);
  }
  if (dryRun) {
    console.log("[dry-run] SQL не выполнялся.");
  }

  await runtime.shutdown?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
