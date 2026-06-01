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
  /** Удалено строк phase_coverage (pending + processing). */
  queueCleared: number;
  /** @deprecated оставлено для совместимости API; всегда 0 (очередь удаляется, не pending). */
  processingReleased: number;
};

/**
 * Полная остановка энричеров: cancel runs + выбросить очередь phase_coverage.
 * Иначе scheduled-тик снова стартует drain по pending.
 */
export async function stopAllActivePhaseRuns(input: {
  dataSource: DataSource;
  repos: WorkerDbRepositories;
  reason?: string;
  /** Ограничить очистку очереди фазами; по умолчанию — все фазы из phase_definitions. */
  phaseIds?: string[];
}): Promise<StopAllActivePhaseRunsResult> {
  const reason = input.reason ?? STOP_ALL_PHASE_RUNS_REASON;
  const phaseIds =
    input.phaseIds ?? (await input.repos.phaseDefinitions.listAll()).map((p) => p.id);

  const toStop = await listActiveRuns(input.repos);
  for (const run of toStop) {
    await input.repos.phaseRuns.requestControl(run.id, "cancel");
  }

  const queueCleared = await input.repos.phaseCoverage.clearQueuedWork(phaseIds);

  const closedRows = (await input.dataSource.query(
    `UPDATE phase_runs SET
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
    processingReleased: 0,
  };
}
