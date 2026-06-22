import { MONOREPO_ROOT } from "@repo/root";
import { clearOperationalContent } from "../application/archive/clearOperationalContent.js";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { notifyMapPushSnapshot } from "../infrastructure/notifyMapPushSnapshot.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";
import { hasAnyFlag, parseLongFlagsMap } from "./workerCliArgs.js";
import { warnDeprecatedNpmScript } from "./deprecatedNpmScript.js";
import { createWipeLogger } from "../application/archive/wipeLog.js";

function printPlan(): void {
  console.log(`
pipeline clear — полный сброс операционного контента (конфиг сохраняется):

  • phase_runs, phase_coverage, domain_events
  • parsed_events, parse_attempts, event_locations
  • event_evidence, place_enrichment_jobs
  • ingest cursors/backfill
  • raw_messages

Не трогает: channels, providers, bindings, regions/places (справочник), phase_definitions.

По умолчанию закрывает прочие подключения к БД (dev/API/worker) перед TRUNCATE.
Флаги: --dry-run, --verbose, --no-force-locks (только если dev уже остановлен вручную).

После: F5 на карте (или push-snapshot если api запущен); ingest/reparse заново.
`);
}

async function main(): Promise<void> {
  warnDeprecatedNpmScript("parse-engine:archive:clear");
  loadRootEnv(MONOREPO_ROOT);
  const flags = parseLongFlagsMap(process.argv);
  const dryRun = hasAnyFlag(flags, ["dry-run", "dryRun"]);
  const verbose = hasAnyFlag(flags, ["verbose", "v"]);
  const forceLocks = !hasAnyFlag(flags, ["no-force-locks", "noForceLocks"]);
  const log = createWipeLogger(verbose);

  if (hasAnyFlag(flags, ["help", "h"])) {
    console.log("Usage: npm run radar -- pipeline clear [-- --dry-run] [--verbose] [--no-force-locks]");
    printPlan();
    process.exit(0);
  }

  printPlan();
  if (dryRun) {
    console.log("[dry-run] SQL не выполнялся.");
    process.exit(0);
  }

  if (!forceLocks) {
    log.line("без forceLocks: остановите npm run dev / worker вручную");
  }

  const runtime = await createWorkerCompositionRoot({
    storageMode: WorkerStorageMode.Db,
    startIngestParseDaemon: false,
  });
  if (!runtime.dataSource || !runtime.workerRepos) {
    console.error("pipeline clear: нужен RADAR_STORAGE_MODE=db и DATABASE_URL");
    process.exit(1);
  }

  const result = await clearOperationalContent({
    dataSource: runtime.dataSource,
    repos: runtime.workerRepos,
    forceLocks,
    log,
    onStep: {
      stepBegin: (label) => console.log(`[pipeline:clear]   → ${label}...`),
      stepDone: (label, rows, durationMs) => {
        const rowsLabel = rows >= 0 ? `rows=${rows}` : "truncated";
        console.log(
          `[pipeline:clear]   ${label}: ${rowsLabel} (${(durationMs / 1000).toFixed(1)}s)`,
        );
      },
    },
  });

  console.log("\nРезультат pipeline clear:");
  console.log(`  raw_messages: ${result.rawMessagesDeleted}`);
  console.log(`  parsed_events: ${result.parsedEventsDeleted}`);
  console.log(`  parse_attempts: ${result.parseAttemptsDeleted}`);
  console.log(
    `  map-state (no-op): places=${result.map.placesCleared} regions=${result.map.regionsCleared}`,
  );
  console.log(`  phase_runs: ${result.phaseRunsDeleted} (остановлено ${result.phaseRunsStopped})`);
  console.log(`  phase_coverage queue: ${result.queueCleared}`);
  console.log(`  domain_events: ${result.domainEventsDeleted}`);
  console.log(
    `  event_evidence: ${result.eventEvidenceDeleted} place_enrichment_jobs: ${result.placeEnrichmentJobsDeleted}`,
  );
  console.log(
    `  ingest: backfill=${result.ingest.backfillJobsDeleted} cursors=${result.ingest.cursorsDeleted}`,
  );

  await notifyMapPushSnapshot();
  console.log("\nГотово. Перезапусти dev-стек: npm run radar -- stack dev --full");
  await runtime.shutdown?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
