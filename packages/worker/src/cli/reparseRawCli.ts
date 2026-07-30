import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { runFullReparseLikeIngest } from "../application/phases/reparseOrchestrator.js";
import { createPhaseOperationalDeps } from "../application/phases/phaseOperationalDeps.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { notifyMapPushSnapshot } from "../infrastructure/notifyMapPushSnapshot.js";
import { cliWorkerRuntime } from "./cliWorkerRuntime.js";
import { createProgress } from "./progress.js";
import { hasAnyFlag, parseLongFlagsMap } from "./workerCliArgs.js";

const REPARSE_PROGRESS_PREFIX = "[reparse-progress] ";

type ReparseProgress = {
  processed: number;
  ok: number;
  failed: number;
};

/** Передаёт API точный результат drain текущего reparse, без чужих worker-attempts. */
function reportProgress(progress: ReparseProgress): void {
  if (process.env.RADAR_REPARSE_PROGRESS !== "1") return;
  console.log(`${REPARSE_PROGRESS_PREFIX}${JSON.stringify(progress)}`);
}

/**
 * Полный reparse: сброс карты + wipe parsed/workspace + ingest-поток по всем raw.
 * Сброс внутри runFullReparseLikeIngest — отдельный pipeline reset перед этим не нужен.
 * Scheduled ingestParse — IngestParseDaemon, после eager по order в манифесте.
 */
async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const flags = parseLongFlagsMap(process.argv);
  const drainScheduled = hasAnyFlag(flags, ["drain-scheduled", "drainScheduled"]);
  const forceLocks = !hasAnyFlag(flags, ["no-force-locks", "noForceLocks"]);
  const runtime = await createWorkerCompositionRoot(cliWorkerRuntime("parse", ["parse", "geo"]));

  if (!runtime.operationalSql || !runtime.phaseRunner || !runtime.workerRepos || !runtime.coverageEnqueuer) {
    console.error("reparseRawCli: нужен RADAR_STORAGE_MODE=db");
    process.exit(1);
  }

  const repos = runtime.workerRepos;

  if (forceLocks) {
    console.log(
      "forceLocks: при lock timeout закроем блокирующие сессии dev/API (отключить: --no-force-locks)",
    );
  }
  console.log(
    "reparse: остановите stack dev / worker с IngestParseDaemon — параллельный llm-drain даёт duplicate workspace.",
  );

  const countRows = await runtime.operationalSql.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM mat_ingest_raw`,
  );
  const total = countRows[0]?.count ?? 0;
  const progress = createProgress("reparse:ingest-flow", total);

  const result = await runFullReparseLikeIngest({
    deps: createPhaseOperationalDeps(runtime.operationalSql, repos),
    forceLocks,
    ingestFlow: {
      rawMessages: repos.rawMessages,
      coverageEnqueuer: runtime.coverageEnqueuer,
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
    `Reparse prep: map places=${result.mapPlacesCleared}, regions→grey=${result.mapRegionsGrey}, ` +
      `mat_parse_event=${result.parsedEventsDeleted}, workspaces=${result.workspacesDeleted}`,
  );
  console.log(
    `Reparse done: messages=${result.messages}, coverageInvalidated=${result.phasesInvalidated}. ` +
      "Scheduled ingestParse догонит IngestParseDaemon в worker:dev (после done catalog по order).",
  );

  if (drainScheduled) {
    const scheduledIngest = await repos.phaseDefinitions.listEnabled(undefined, "ingestParse");
    let completed: ReparseProgress = { processed: 0, ok: 0, failed: 0 };

    for (const phase of scheduledIngest) {
      const run = await repos.phaseRuns.create({
        phaseId: phase.id,
        trigger: "manual",
      });
      let phaseProgress: ReparseProgress = { processed: 0, ok: 0, failed: 0 };
      const result = await runtime.phaseRunner.runDrain({
        phase,
        runId: run.id,
        trigger: "manual",
        batchSize: 50,
        onProgress: (stats) => {
          phaseProgress = {
            processed: stats.processed,
            ok: stats.ok,
            failed: stats.failed,
          };
          reportProgress({
            processed: completed.processed + phaseProgress.processed,
            ok: completed.ok + phaseProgress.ok,
            failed: completed.failed + phaseProgress.failed,
          });
        },
      });
      completed = {
        processed: completed.processed + result.processed,
        ok: completed.ok + result.ok,
        failed: completed.failed + result.failed,
      };
      reportProgress(completed);
    }
    const scheduledGeo = await repos.phaseDefinitions.listEnabled("scheduled", "geoParse");
    const { runGeoPhaseDrain } = await import("../application/geo-parse/runGeoPhaseDrain.js");
    for (const phase of scheduledGeo) {
      if (!runtime.placeEnrichmentRunner || !runtime.phaseRunSession) continue;
      const run = await repos.phaseRuns.create({
        phaseId: phase.id,
        trigger: "manual",
      });
      await runGeoPhaseDrain(
        {
          placeEnrichmentRunner: runtime.placeEnrichmentRunner,
          placeEnrichmentJobs: repos.placeEnrichmentJobs,
          session: runtime.phaseRunSession,
        },
        {
          phase,
          runId: run.id,
          trigger: "manual",
          batchSize: phase.policy.batchSize,
        },
      );
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
