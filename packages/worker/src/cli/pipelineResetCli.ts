import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import {
  PIPELINE_RESET_REASON,
  runPipelineOperationalReset,
} from "../application/phases/pipelineOperationalReset.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { notifyMapPushSnapshot } from "../infrastructure/notifyMapPushSnapshot.js";
import { hasAnyFlag, parseLongFlagsMap } from "./workerCliArgs.js";

function printPlan(): void {
  console.log(`
Операционный сброс (архив raw_messages сохраняется):

  • place_status_active — deactivate
  • region_state_active — grey
  • parsed_events + event_locations (CASCADE)
  • parse_attempts
  • phase_coverage — invalidate + processing→pending
  • phase_runs — cancel running/paused/pending
  • catch-up pending для enabled eager+scheduled (если не --no-catch-up)

Не трогает: raw_messages, ingest_*, channels, places/regions (справочник), phase_definitions.

После сброса: npm run worker:dev  или  npm run worker:reparse:raw
`);
}

/**
 * CLI: сброс карты, parse-результатов и очередей фаз без удаления raw_messages.
 */
async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const flags = parseLongFlagsMap(process.argv);
  const dryRun = hasAnyFlag(flags, ["dry-run", "dryRun"]);
  const noCatchUp = hasAnyFlag(flags, ["no-catch-up", "noCatchUp"]);

  if (hasAnyFlag(flags, ["help", "h"])) {
    console.log("Usage: npm run clear:pipeline [--dry-run] [--no-catch-up]  (alias: reset:pipeline)");
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
    console.error("reset:pipeline: нужен RADAR_STORAGE_MODE=db и DATABASE_URL");
    process.exit(1);
  }

  const result = await runPipelineOperationalReset({
    dataSource: runtime.dataSource,
    repos: runtime.workerRepos,
    enqueueCatchUp: !noCatchUp,
  });

  console.log(`\nСброс (${PIPELINE_RESET_REASON}):`);
  console.log(`  карта: places=${result.mapPlacesCleared}, regions→grey=${result.mapRegionsGrey}`);
  console.log(`  parsed_events удалено: ${result.parsedEventsDeleted}`);
  console.log(`  parse_attempts удалено: ${result.parseAttemptsDeleted}`);
  console.log(`  phase_coverage invalidate: ${result.coverageInvalidated}`);
  console.log(`  phase_coverage processing→pending: ${result.coverageProcessingToPending}`);
  console.log(`  phase_runs закрыто: ${result.phaseRunsClosed}`);
  if (!noCatchUp) {
    console.log(`  catch-up: ${JSON.stringify(result.catchUpByPhase)}`);
    console.log("\nДальше: npm run worker:dev (scheduled) или npm run worker:reparse:raw (catalog по всем raw).");
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
