import { MONOREPO_ROOT } from "@repo/root";
import {
  clearRawArchive,
  countRawArchiveBlockers,
  ClearRawArchiveBlockedError,
} from "../application/archive/clearRawArchive.js";
import { stopAllActivePhaseRuns } from "../application/phases/stopAllActivePhaseRuns.js";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";
import { hasAnyFlag, parseLongFlagsMap } from "./workerCliArgs.js";

function printPlan(): void {
  console.log(`
parse-engine:clear:raw — удаление архива mat_ingest_raw:

  • log_parse_phase_run активные — cancel (безопасность)
  • DELETE mat_ingest_raw (CASCADE: mat_ingest_raw_tg, queue_parse_coverage)

Требует пустых mat_parse_event и log_parse_attempt.
Если есть события: npm run parse-engine:reset  или  parse-engine:clear:raw -- --with-pipeline
`);
}

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const flags = parseLongFlagsMap(process.argv);
  const dryRun = hasAnyFlag(flags, ["dry-run", "dryRun"]);
  const withPipeline = hasAnyFlag(flags, ["with-pipeline", "withPipeline"]);

  if (hasAnyFlag(flags, ["help", "h"])) {
    console.log("Usage: npm run parse-engine:clear:raw [--dry-run] [--with-pipeline]");
    printPlan();
    process.exit(0);
  }

  printPlan();

  const runtime = await createWorkerCompositionRoot({
    storageMode: WorkerStorageMode.Db,
    startIngestParseDaemon: false,
  });
  if (!runtime.dataSource || !runtime.workerRepos) {
    console.error("clear:raw: нужен RADAR_STORAGE_MODE=db и DATABASE_URL");
    process.exit(1);
  }

  const before = await countRawArchiveBlockers(runtime.dataSource);
  console.log(
    `До: raw=${before.rawMessages} mat_parse_event=${before.parsedEvents} log_parse_attempt=${before.parseAttempts}`,
  );

  if (dryRun) {
    console.log("[dry-run] SQL не выполнялся.");
    await runtime.shutdown?.();
    process.exit(0);
  }

  if (withPipeline && (before.parsedEvents > 0 || before.parseAttempts > 0)) {
    const { runPipelineOperationalReset } = await import(
      "../application/phases/pipelineOperationalReset.js"
    );
    console.log("parse-engine:clear:raw: сначала parse-engine:reset…");
    await stopAllActivePhaseRuns({
      dataSource: runtime.dataSource,
      repos: runtime.workerRepos,
      reason: "clear:raw",
    });
    await runPipelineOperationalReset({
      dataSource: runtime.dataSource,
      repos: runtime.workerRepos,
      enqueueCatchUp: false,
    });
  }

  try {
    await stopAllActivePhaseRuns({
      dataSource: runtime.dataSource,
      repos: runtime.workerRepos,
      reason: "clear:raw",
    });
    const result = await clearRawArchive(runtime.dataSource);
    console.log(`\nУдалено mat_ingest_raw: ${result.rawMessagesDeleted}`);
  } catch (err) {
    if (err instanceof ClearRawArchiveBlockedError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  await runtime.shutdown?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
