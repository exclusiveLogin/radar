import { MONOREPO_ROOT } from "@repo/root";
import { runSystemFullWipe } from "../application/archive/runSystemFullWipe.js";
import { GeoCatalog } from "../infrastructure/geo-catalog/geoCatalog.js";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { notifyMapPushSnapshot } from "../infrastructure/notifyMapPushSnapshot.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";
import { hasAnyFlag, parseLongFlagsMap } from "./workerCliArgs.js";

/** Подтверждение из argv или RADAR_CONFIRM_SYSTEM_WIPE (для system:reset без вложенного npm). */
function isWipeConfirmed(flags: ReturnType<typeof parseLongFlagsMap>): boolean {
  if (hasAnyFlag(flags, ["confirm", "yes", "y"])) {
    return true;
  }
  const raw = process.env.RADAR_CONFIRM_SYSTEM_WIPE?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function printHelp(): void {
  console.log(`Usage: npm run parse-engine:system:wipe -- --confirm [--dry-run]

  Полный wipe БД (без конфига ingest/фаз):
    • raw_messages, parsed_events, parse_attempts, phase_runs, domain_events
    • ingest cursors/backfill, read-model карты
    • places, place_aliases, geo_feature, place_geo_link, geo_dataset_file, regions

  После wipe вручную или через npm run system:reset -- --confirm:
    npm run geo:init
    npm run parse-engine:rebuild:drain   # когда нужен перепарс
`);
}

/** Полный wipe операционки + гео-каталога. */
async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const flags = parseLongFlagsMap(process.argv);
  const dryRun = hasAnyFlag(flags, ["dry-run", "dryRun"]);
  const confirm = isWipeConfirmed(flags);

  if (hasAnyFlag(flags, ["help", "h"])) {
    printHelp();
    process.exit(0);
  }

  if (!confirm && !dryRun) {
    console.error("Опасная операция. Добавьте --confirm (или --dry-run для просмотра).");
    printHelp();
    process.exit(1);
  }

  if (dryRun) {
    console.log("[dry-run] system:wipe не выполнялся.");
    process.exit(0);
  }

  const runtime = await createWorkerCompositionRoot({
    storageMode: WorkerStorageMode.Db,
    startIngestParseDaemon: false,
    geoCatalog: GeoCatalog.empty(),
  });
  if (!runtime.dataSource || !runtime.workerRepos) {
    console.error("system:wipe: нужен RADAR_STORAGE_MODE=db и DATABASE_URL");
    process.exit(1);
  }

  const { steps } = await runSystemFullWipe({
    dataSource: runtime.dataSource,
    repos: runtime.workerRepos,
  });

  console.log("\nvendor-ingest-parse-geo:wipe done");
  for (const step of steps) {
    console.log(`  [${step.phase}]`);
    for (const [k, v] of Object.entries(step.counts)) {
      console.log(`    ${k}: ${v}`);
    }
  }

  await notifyMapPushSnapshot();
  console.log("\nДальше: npm run geo:run  или  npm run system:reset -- --confirm");
  await runtime.shutdown?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
