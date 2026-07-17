import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";

/** Снимок: очередь geo, активные runs, залипшие processing, движение за минуту. */
async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const runtime = await createWorkerCompositionRoot({
    workerRole: "geo",
    bootCaps: ["geo"],
    storageMode: WorkerStorageMode.Db,
    startIngestParseDaemon: false,
  });
  if (!runtime.dataSource) throw new Error("db required");

  const ds = runtime.dataSource;

  const byStatus = await ds.query(
    `SELECT provider, status, COUNT(*)::int AS n
     FROM job_geo_place_enrich GROUP BY provider, status ORDER BY provider, status`,
  );
  console.log("jobs by provider/status:", byStatus);

  const stuckProcessing = await ds.query(
    `SELECT COUNT(*)::int AS n FROM job_geo_place_enrich
     WHERE status = 'processing'
       AND updated_at < now() - interval '10 minutes'`,
  );
  console.log("processing older than 10m:", stuckProcessing[0]?.n);

  const runs = await ds.query(
    `SELECT id, phase_id, status, trigger, control,
            stats->>'ok' AS ok, stats->>'pendingRemaining' AS pending_remaining,
            started_at, updated_at
     FROM log_parse_phase_run
     WHERE status IN ('running','pending','paused')
     ORDER BY updated_at DESC LIMIT 10`,
  );
  console.log("active log_parse_phase_run:", runs);

  const phases = await ds.query(
    `SELECT id, enabled, scope, trigger FROM phase_definitions WHERE id LIKE 'geo%' OR scope = 'geoParse'`,
  );
  console.log("geo phase_definitions:", phases);

  const doneA = (await ds.query(
    `SELECT COUNT(*)::int AS n FROM job_geo_place_enrich WHERE provider='dadata' AND status='done'`,
  )) as Array<{ n: number }>;
  console.log("dadata done now:", doneA[0]?.n);
  console.log("wait 15s…");
  await new Promise((r) => setTimeout(r, 15_000));
  const doneB = (await ds.query(
    `SELECT COUNT(*)::int AS n FROM job_geo_place_enrich WHERE provider='dadata' AND status='done'`,
  )) as Array<{ n: number }>;
  console.log("dadata done +15s:", doneB[0]?.n, "delta:", (doneB[0]?.n ?? 0) - (doneA[0]?.n ?? 0));

  await runtime.shutdown?.();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
