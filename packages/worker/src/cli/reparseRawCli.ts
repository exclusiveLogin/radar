import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { MapStateFullReset } from "../application/map-state/mapStateFullReset.js";
import { runFullReparseLikeIngest } from "../application/phases/reparseOrchestrator.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { createProgress } from "./progress.js";

/**
 * Полный reparse: сброс карты + инвалидация parsed/coverage, затем ingest-поток (eager inline).
 * Scheduled-фазы — PhaseDaemon, строго после eager по order в манифесте.
 */
async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const runtime = await createWorkerCompositionRoot({
    storageMode: WorkerStorageMode.Db,
  });

  if (!runtime.dataSource || !runtime.phaseRunner || !runtime.workerRepos || !runtime.coverageEnqueuer) {
    console.error("reparseRawCli: нужен RADAR_STORAGE_MODE=db");
    process.exit(1);
  }

  const repos = runtime.workerRepos;

  const reset = new MapStateFullReset({
    regionState: repos.regionState,
    placeStatus: repos.placeStatus,
    regions: repos.regions,
  });
  const resetResult = await reset.run();
  console.log(
    `Map state reset: places=${resetResult.placesCleared}, regions=${resetResult.regionsGrey}`,
  );

  const countRows = (await runtime.dataSource.query(
    `SELECT COUNT(*)::int AS count FROM raw_messages`,
  )) as Array<{ count: number }>;
  const total = countRows[0]?.count ?? 0;
  const progress = createProgress("reparse:ingest-flow", total);

  const result = await runFullReparseLikeIngest({
    dataSource: runtime.dataSource,
    repos,
    ingestFlow: {
      rawMessages: repos.rawMessages,
      phases: repos.phaseDefinitions,
      enqueuer: runtime.coverageEnqueuer,
      runner: runtime.phaseRunner,
    },
    onMessage: () => progress.tick(1),
  });
  progress.stop();

  console.log(
    `Reparse done: messages=${result.messages}, coverageInvalidated=${result.phasesInvalidated}. ` +
      "Scheduled-фазы догонит PhaseDaemon (после done eager по order).",
  );
  await runtime.shutdown?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
