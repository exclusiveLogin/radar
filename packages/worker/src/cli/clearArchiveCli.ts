import { MONOREPO_ROOT } from "@repo/root";
import { clearOperationalContent } from "../application/archive/clearOperationalContent.js";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { notifyMapPushSnapshot } from "../infrastructure/notifyMapPushSnapshot.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";
import { hasAnyFlag, parseLongFlagsMap } from "./workerCliArgs.js";

function printPlan(): void {
  console.log(`
clear:archive — полный сброс операционного контента (конфиг сохраняется):

  • phase_runs, phase_coverage, domain_events
  • parsed_events, parse_attempts, event_locations
  • region_state → grey, place_status, history лент
  • place_evidence, place_cache
  • ingest cursors/backfill
  • raw_messages

Не трогает: channels, providers, bindings, regions/places (справочник), phase_definitions.

После: F5 на карте (или push-snapshot если api запущен); ingest/reparse заново.
`);
}

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const flags = parseLongFlagsMap(process.argv);
  const dryRun = hasAnyFlag(flags, ["dry-run", "dryRun"]);

  if (hasAnyFlag(flags, ["help", "h"])) {
    console.log("Usage: npm run clear:archive [--dry-run]");
    printPlan();
    process.exit(0);
  }

  printPlan();
  if (dryRun) {
    console.log("[dry-run] SQL не выполнялся.");
    process.exit(0);
  }

  const runtime = await createWorkerCompositionRoot({
    storageMode: WorkerStorageMode.Db,
    startPhaseDaemon: false,
  });
  if (!runtime.dataSource || !runtime.workerRepos) {
    console.error("clear:archive: нужен RADAR_STORAGE_MODE=db и DATABASE_URL");
    process.exit(1);
  }

  const result = await clearOperationalContent({
    dataSource: runtime.dataSource,
    repos: runtime.workerRepos,
  });

  console.log("\nРезультат clear:archive:");
  console.log(`  raw_messages: ${result.rawMessagesDeleted}`);
  console.log(`  parsed_events: ${result.parsedEventsDeleted}`);
  console.log(`  parse_attempts: ${result.parseAttemptsDeleted}`);
  console.log(
    `  карта(read-model): places=${result.map.placesCleared} regions=${result.map.regionsCleared}`,
  );
  console.log(`  phase_runs: ${result.phaseRunsDeleted} (остановлено ${result.phaseRunsStopped})`);
  console.log(`  phase_coverage queue: ${result.queueCleared}`);
  console.log(`  domain_events: ${result.domainEventsDeleted}`);
  console.log(`  place_evidence: ${result.placeEvidenceDeleted} place_cache: ${result.placeCacheDeleted}`);
  console.log(
    `  ingest: backfill=${result.ingest.backfillJobsDeleted} cursors=${result.ingest.cursorsDeleted}`,
  );

  await notifyMapPushSnapshot();
  console.log("\nГотово. Останови worker или выключи фазы, чтобы не наполнять снова.");
  await runtime.shutdown?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
