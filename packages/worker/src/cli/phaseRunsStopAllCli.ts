import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { stopAllActivePhaseRuns } from "../application/phases/stopAllActivePhaseRuns.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";

/**
 * CLI: cancel runs + очистка ingest (queue_parse_coverage) и geo (job_geo_place_enrich).
 */
async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);

  const runtime = await createWorkerCompositionRoot({
    workerRole: "parse",
    bootCaps: ["parse","geo"],
    storageMode: WorkerStorageMode.Db,
    startIngestParseDaemon: false,
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
    `Остановлено runs: ${result.phaseRunsClosed}, ingest coverage: ${result.queueCleared}, geo jobs: ${result.geoJobsCleared}`,
  );
  await runtime.shutdown?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
