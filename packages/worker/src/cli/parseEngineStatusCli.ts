import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";

type StatusScope = "all" | "ingest" | "geo" | "runs";

function resolveScope(argv: string[]): StatusScope {
  const positional = argv.slice(2).find((token) => !token.startsWith("-"));
  switch (positional) {
    case "ingest":
    case "geo":
    case "runs":
      return positional;
    default:
      return "all";
  }
}

async function printIngestQueues(
  repos: NonNullable<Awaited<ReturnType<typeof createWorkerCompositionRoot>>["workerRepos"]>,
): Promise<void> {
  const phases = await repos.phaseDefinitions.listEnabled(undefined, "ingestParse");
  console.log("ingest.queue_parse_coverage (total) =", await repos.phaseCoverage.countByStatus());
  for (const phase of phases) {
    const counts = await repos.phaseCoverage.countByStatus(phase.id);
    const pending = counts.pending + counts.processing;
    if (pending === 0 && counts.done === 0 && counts.failed === 0) continue;
    console.log(`  [${phase.id}] trigger=${phase.trigger}`, counts);
  }
}

async function printGeoQueues(
  dataSource: NonNullable<Awaited<ReturnType<typeof createWorkerCompositionRoot>>["dataSource"]>,
): Promise<void> {
  const byStatus = (await dataSource.query(
    `SELECT status, COUNT(*)::int AS count
     FROM job_geo_place_enrich
     GROUP BY status
     ORDER BY status`,
  )) as Array<{ status: string; count: number }>;
  console.log(
    "geo.job_geo_place_enrich =",
    Object.fromEntries(byStatus.map((row) => [row.status, Number(row.count)])),
  );

  const byProvider = (await dataSource.query(
    `SELECT provider, status, COUNT(*)::int AS count
     FROM job_geo_place_enrich
     GROUP BY provider, status
     ORDER BY provider, status`,
  )) as Array<{ provider: string; status: string; count: number }>;
  for (const row of byProvider) {
    console.log(`  [${row.provider}] ${row.status}=${row.count}`);
  }
}

async function printActiveRuns(
  dataSource: NonNullable<Awaited<ReturnType<typeof createWorkerCompositionRoot>>["dataSource"]>,
): Promise<void> {
  const runs = (await dataSource.query(
    `SELECT id, phase_id, status, trigger, started_at, updated_at
     FROM log_parse_phase_run
     WHERE status IN ('pending', 'running', 'paused')
     ORDER BY started_at DESC NULLS LAST
     LIMIT 50`,
  )) as Array<{
    id: string;
    phase_id: string;
    status: string;
    trigger: string;
    started_at: string | null;
    updated_at: string;
  }>;
  if (runs.length === 0) {
    console.log("log_parse_phase_run: активных нет");
    return;
  }
  console.log(`log_parse_phase_run: активных ${runs.length}`);
  for (const run of runs) {
    console.log(
      `  ${run.id} phase=${run.phase_id} status=${run.status} trigger=${run.trigger}`,
    );
  }
}

/**
 * Сводка parse engine для планирования drain.
 * Scope: all | ingest | geo | runs (npm: parse-engine:status | queue:ingest | queue:geo | runs:status).
 */
async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const scope = resolveScope(process.argv);
  const runtime = await createWorkerCompositionRoot({
    workerRole: "parse",
    bootCaps: ["parse","geo"],
    storageMode: WorkerStorageMode.Db,
    startIngestParseDaemon: false,
  });
  if (!runtime.dataSource || !runtime.workerRepos) {
    throw new Error("parseEngineStatusCli: требуется db mode");
  }

  if (scope === "all" || scope === "ingest") {
    await printIngestQueues(runtime.workerRepos);
  }
  if (scope === "all" || scope === "geo") {
    await printGeoQueues(runtime.dataSource);
  }
  if (scope === "all" || scope === "runs") {
    await printActiveRuns(runtime.dataSource);
  }

  await runtime.shutdown?.();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
