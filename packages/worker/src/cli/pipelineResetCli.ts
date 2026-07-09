import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import {
  PIPELINE_RESET_REASON,
  runPipelineOperationalReset,
} from "../application/phases/pipelineOperationalReset.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { notifyMapPushSnapshot } from "../infrastructure/notifyMapPushSnapshot.js";
import { buildTestPlaceScanService } from "../domain/parse/geo/testPlaceScanFixture.js";
import { hasAnyFlag, parseLongFlagsMap } from "./workerCliArgs.js";
import { warnDeprecatedNpmScript } from "./deprecatedNpmScript.js";

function printPlan(): void {
  console.log(`
Операционный сброс (архив mat_ingest_raw сохраняется):

  • mat_parse_event + mat_parse_location (CASCADE)
  • log_parse_attempt
  • queue_parse_coverage — invalidate + processing→pending
  • log_parse_phase_run — cancel running/paused/pending
  • catch-up pending для enabled eager+scheduled (если не --no-catch-up)

Не трогает: mat_ingest_raw, ingest_*, channels, places/regions (справочник), phase_definitions.

После сброса: npm run radar -- stack dev --full  (catch-up без reparse)
              или  npm run radar -- parse run     (полный reparse, reset не нужен)
`);
}

/**
 * CLI: сброс карты, parse-результатов и очередей фаз без удаления mat_ingest_raw.
 */
async function main(): Promise<void> {
  warnDeprecatedNpmScript("parse-engine:pipeline:reset");
  loadRootEnv(MONOREPO_ROOT);
  const flags = parseLongFlagsMap(process.argv);
  const dryRun = hasAnyFlag(flags, ["dry-run", "dryRun"]);
  const noCatchUp = hasAnyFlag(flags, ["no-catch-up", "noCatchUp"]);
  const forceLocks = !hasAnyFlag(flags, ["no-force-locks", "noForceLocks"]);

  if (hasAnyFlag(flags, ["help", "h"])) {
    console.log("Usage: npm run parse-engine:pipeline:reset [--dry-run] [--no-catch-up] [--no-force-locks]");
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
    startIngestParseDaemon: false,
    // Сброс не парсит сообщения — geo scan из БД не нужен.
    placeScan: buildTestPlaceScanService([]),
  });

  if (!runtime.dataSource || !runtime.workerRepos) {
    console.error("parse-engine:reset: нужен RADAR_STORAGE_MODE=db и DATABASE_URL");
    process.exit(1);
  }

  const result = await runPipelineOperationalReset({
    dataSource: runtime.dataSource,
    repos: runtime.workerRepos,
    enqueueCatchUp: !noCatchUp,
    forceLocks,
  });

  console.log(`\nСброс (${PIPELINE_RESET_REASON}):`);
  console.log(`  карта: places=${result.mapPlacesCleared}, regions→grey=${result.mapRegionsGrey}`);
  console.log(`  mat_parse_event удалено: ${result.parsedEventsDeleted}`);
  console.log(`  log_parse_attempt удалено: ${result.parseAttemptsDeleted}`);
  console.log(`  queue_parse_coverage invalidate: ${result.coverageInvalidated}`);
  console.log(`  queue_parse_coverage processing→pending: ${result.coverageProcessingToPending}`);
  console.log(`  log_parse_phase_run закрыто: ${result.phaseRunsClosed}`);
  if (!noCatchUp) {
    console.log(`  catch-up: ${JSON.stringify(result.catchUpByPhase)}`);
    console.log("\nДальше: npm run worker:dev (scheduled) или npm run parse-engine:rebuild.");
  } else {
    console.log("\nCatch-up пропущен (--no-catch-up).");
  }

  await notifyMapPushSnapshot();
  await runtime.shutdown?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
