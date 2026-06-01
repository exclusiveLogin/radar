import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { stopAllActivePhaseRuns } from "../application/phases/stopAllActivePhaseRuns.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";

/**
 * CLI: cancel runs + удалить pending/processing из phase_coverage.
 */
async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);

  const runtime = await createWorkerCompositionRoot({
    storageMode: WorkerStorageMode.Db,
    startPhaseDaemon: false,
  });

  if (!runtime.dataSource || !runtime.workerRepos) {
    console.error("phase:runs:stop-all: нужен RADAR_STORAGE_MODE=db и DATABASE_URL");
    process.exit(1);
  }

  const result = await stopAllActivePhaseRuns({
    dataSource: runtime.dataSource,
    repos: runtime.workerRepos,
  });

  console.log(
    `Остановлено runs: ${result.phaseRunsClosed}, очередь удалена: ${result.queueCleared}`,
  );
  await runtime.shutdown?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
