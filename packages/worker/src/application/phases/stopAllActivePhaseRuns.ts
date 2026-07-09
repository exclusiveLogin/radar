import type { PhaseRun } from "@radar/shared";
import type { DataSource } from "typeorm";
import type { WorkerDbRepositories } from "../../infrastructure/persistence/workerDbRepos.types.js";

export const STOP_ALL_PHASE_RUNS_REASON = "admin:stop-all-active-runs";

const ACTIVE_STATUSES = ["running", "paused", "pending"] as const;

async function listActiveRuns(repos: WorkerDbRepositories): Promise<PhaseRun[]> {
  const chunks = await Promise.all(
    ACTIVE_STATUSES.map((status) => repos.phaseRuns.list({ status, limit: 200 })),
  );
  return chunks.flat();
}

export type StopAllActivePhaseRunsResult = {
  phaseRunsClosed: number;
  /** Удалено строк queue_parse_coverage (pending + processing), ingest. */
  queueCleared: number;
  /** Удалено строк job_geo_place_enrich (pending + processing), geo. */
  geoJobsCleared: number;
  /** @deprecated оставлено для совместимости API; всегда 0 (очередь удаляется, не pending). */
  processingReleased: number;
};

/**
 * Полная остановка parse-engine: cancel runs + ingest coverage + geo jobs.
 * Иначе scheduled-тик / GeoParseDaemon снова подхватят backlog.
 */
export async function stopAllActivePhaseRuns(input: {
  dataSource: DataSource;
  repos: WorkerDbRepositories;
  reason?: string;
  /** Ограничить очистку ingest-очереди; по умолчанию — все ingestParse фазы. */
  ingestPhaseIds?: string[];
  /** false — не трогать job_geo_place_enrich (узкий сброс только ingest). */
  clearGeoJobs?: boolean;
}): Promise<StopAllActivePhaseRunsResult> {
  const reason = input.reason ?? STOP_ALL_PHASE_RUNS_REASON;
  const ingestPhaseIds =
    input.ingestPhaseIds ??
    (await input.repos.phaseDefinitions.listAll())
      .filter((p) => p.scope === "ingestParse")
      .map((p) => p.id);

  const toStop = await listActiveRuns(input.repos);
  for (const run of toStop) {
    await input.repos.phaseRuns.requestControl(run.id, "cancel");
  }

  const queueCleared = await input.repos.phaseCoverage.clearQueuedWork(ingestPhaseIds);
  const geoJobsCleared =
    input.clearGeoJobs === false
      ? 0
      : await input.repos.placeEnrichmentJobs.clearQueuedWork();

  const closedRows = (await input.dataSource.query(
    `UPDATE log_parse_phase_run SET
       status = 'canceled',
       control = 'cancel',
       finished_at = now(),
       error = COALESCE(error, $1),
       updated_at = now()
     WHERE status IN ('running', 'paused', 'pending')
     RETURNING id`,
    [reason],
  )) as Array<{ id: string }>;

  return {
    phaseRunsClosed: closedRows.length,
    queueCleared,
    geoJobsCleared,
    processingReleased: 0,
  };
}
