import { MONOREPO_ROOT } from "@repo/root";
import { wipePlacesCatalog } from "../application/archive/wipePlacesCatalog.js";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";
import { hasAnyFlag, parseLongFlagsMap } from "./workerCliArgs.js";

/** Wipe places без raw/regions; для полного сброса — system:reset. */
async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const flags = parseLongFlagsMap(process.argv);
  const dryRun = hasAnyFlag(flags, ["dry-run", "dryRun"]);

  if (hasAnyFlag(flags, ["help", "h"])) {
    console.log(`Usage: npm run parse-engine:catalog:wipe [--dry-run]

  Удаляет places, aliases, geo_feature, mat_parse_location.place_id unlink.
  НЕ трогает: mat_ingest_raw, regions.

  Полный wipe + раскатка:
    npm run system:reset -- --confirm`);
    process.exit(0);
  }

  if (dryRun) {
    console.log("[dry-run] wipe places не выполнялся.");
    process.exit(0);
  }

  const runtime = await createWorkerCompositionRoot({
    storageMode: WorkerStorageMode.Db,
    startIngestParseDaemon: false,
  });
  if (!runtime.dataSource || !runtime.workerRepos) {
    console.error("catalog:wipe: нужен RADAR_STORAGE_MODE=db");
    process.exit(1);
  }

  const result = await wipePlacesCatalog({
    dataSource: runtime.dataSource,
    repos: runtime.workerRepos,
  });

  console.log("catalog:wipe done:");
  console.log(`  places deleted: ${result.placesDeleted}`);
  console.log(`  aliases deleted: ${result.aliasesDeleted}`);
  console.log(`  geo jobs deleted: ${result.enrichmentJobsDeleted}`);
  console.log(`  mat_parse_evidence deleted: ${result.eventEvidenceDeleted}`);
  console.log(`  regions.canonical_place_id cleared: ${result.regionsCanonicalCleared}`);
  console.log("\nДальше: npm run geo:db:apply && npm run parse-engine:rebuild:drain");

  await runtime.shutdown?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
