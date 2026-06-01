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
clear:raw — удаление архива raw_messages:

  • phase_runs активные — cancel (безопасность)
  • DELETE raw_messages (CASCADE: raw_message_telegram, phase_coverage)

Требует пустых parsed_events и parse_attempts.
Если есть события: npm run clear:pipeline  или  npm run clear:raw -- --with-pipeline
`);
}

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const flags = parseLongFlagsMap(process.argv);
  const dryRun = hasAnyFlag(flags, ["dry-run", "dryRun"]);
  const withPipeline = hasAnyFlag(flags, ["with-pipeline", "withPipeline"]);

  if (hasAnyFlag(flags, ["help", "h"])) {
    console.log("Usage: npm run clear:raw [--dry-run] [--with-pipeline]");
    printPlan();
    process.exit(0);
  }

  printPlan();

  const runtime = await createWorkerCompositionRoot({
    storageMode: WorkerStorageMode.Db,
    startPhaseDaemon: false,
  });
  if (!runtime.dataSource || !runtime.workerRepos) {
    console.error("clear:raw: нужен RADAR_STORAGE_MODE=db и DATABASE_URL");
    process.exit(1);
  }

  const before = await countRawArchiveBlockers(runtime.dataSource);
  console.log(
    `До: raw=${before.rawMessages} parsed_events=${before.parsedEvents} parse_attempts=${before.parseAttempts}`,
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
    console.log("clear:raw: сначала clear:pipeline…");
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
    console.log(`\nУдалено raw_messages: ${result.rawMessagesDeleted}`);
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
