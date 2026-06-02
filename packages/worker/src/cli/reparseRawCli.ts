import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { MapStateFullReset } from "../application/map-state/mapStateFullReset.js";
import { runFullReparseLikeIngest } from "../application/phases/reparseOrchestrator.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { notifyMapPushSnapshot } from "../infrastructure/notifyMapPushSnapshot.js";
import { createProgress } from "./progress.js";
import { hasAnyFlag, parseLongFlagsMap } from "./workerCliArgs.js";

/**
 * Полный reparse: сброс карты + инвалидация parsed/coverage, затем ingest-поток (eager inline).
 * Scheduled ingestParse — IngestParseDaemon, после eager по order в манифесте.
 */
async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const flags = parseLongFlagsMap(process.argv);
  const drainScheduled = hasAnyFlag(flags, ["drain-scheduled", "drainScheduled"]);
  const runtime = await createWorkerCompositionRoot({
    storageMode: WorkerStorageMode.Db,
    startIngestParseDaemon: false,
  });

  if (!runtime.dataSource || !runtime.phaseRunner || !runtime.workerRepos || !runtime.coverageEnqueuer) {
    console.error("reparseRawCli: нужен RADAR_STORAGE_MODE=db");
    process.exit(1);
  }

  const repos = runtime.workerRepos;

  const reset = new MapStateFullReset({
    dataSource: runtime.dataSource,
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
    onMessage: () => {
      const snap = runtime.metricsAggregator.snapshot();
      progress.tick(1, {
        ok: snap.MessageParsed ?? 0,
        failed: snap.MessageParseFailed ?? 0,
      });
    },
  });
  progress.stop();

  console.log(
    `Reparse done: messages=${result.messages}, coverageInvalidated=${result.phasesInvalidated}. ` +
      "Scheduled ingestParse догонит IngestParseDaemon в worker:dev (после done catalog по order).",
  );

  if (drainScheduled) {
    const scheduledIngest = await repos.phaseDefinitions.listEnabled("scheduled", "ingestParse");
    for (const phase of scheduledIngest) {
      const run = await repos.phaseRuns.create({
        phaseId: phase.id,
        trigger: "manual",
      });
      await runtime.phaseRunner.runDrain({
        phase,
        runId: run.id,
        trigger: "manual",
        batchSize: 50,
      });
    }
    const scheduledGeo = await repos.phaseDefinitions.listEnabled("scheduled", "geoParse");
    for (const phase of scheduledGeo) {
      const provider = phase.enrichers.includes("llm")
        ? "llm"
        : phase.enrichers.includes("dadata")
          ? "dadata"
          : phase.enrichers.includes("nominatim")
            ? "nominatim"
            : null;
      if (!provider || !runtime.placeEnrichmentRunner) continue;
      await runtime.placeEnrichmentRunner.runDrain(provider, phase.policy.batchSize);
    }
    console.log(
      `Scheduled drain done: ingestPhases=${scheduledIngest.length}, geoPhases=${scheduledGeo.length}`,
    );
  }

  await notifyMapPushSnapshot();
  await runtime.shutdown?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
