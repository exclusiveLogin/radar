import {
  isPgDeadlockError,
  isPgLockNotAvailableError,
  withPgContendedReadRetry,
  withPgDeadlockRetry,
} from "../../infrastructure/pgDeadlockRetry";
import { NEXTGEN_RECOMMENDED_BATCH_SIZE } from "./trackingBatchConstants.js";

/**
 * xact advisory lock — только внутри одной DB-транзакции (один connection из пула).
 * Session lock на ds.query + transaction на другом connection = TRUNCATE без защиты → deadlock.
 */
export const TRACKING_PERSIST_ADVISORY_LOCK_KEY = 75829103;

/** Макс. размер тика daemon — env или schema max (config.batchSize ≤ 20000). */
export function resolveDaemonBatchSize(configBatchSize?: number): number {
  const requested = configBatchSize ?? 500;
  const envCap = Number(process.env.TRACKING_DAEMON_MAX_BATCH_SIZE);
  const cap = Number.isFinite(envCap) && envCap >= 10 ? envCap : 20_000;
  return Math.min(requested, cap);
}

/** @deprecated Используй resolveDaemonBatchSize — оставлено для обратной совместимости env. */
export const TRACKING_DAEMON_MAX_BATCH_SIZE = resolveDaemonBatchSize(500);

export { NEXTGEN_RECOMMENDED_BATCH_SIZE };

export type TrackingPgQueryFn = (sql: string, params?: unknown[]) => Promise<unknown>;

export type TrackingL1TransactionRunner = <T>(
  fn: (query: TrackingPgQueryFn) => Promise<T>,
) => Promise<T>;

export type TrackingDrainRestart = {
  id: string;
  rebuildGen: string;
  startedAt: string;
};

/**
 * Одна транзакция: pg_advisory_xact_lock → mutate L1.
 * API reset/rebuild и worker persist — только через это.
 */
export async function withTrackingL1Transaction<T>(
  runInTransaction: TrackingL1TransactionRunner,
  body: (query: TrackingPgQueryFn) => Promise<T>,
  options?: { maxAttempts?: number; baseDelayMs?: number; lockTimeoutMs?: number },
): Promise<T> {
  return withPgDeadlockRetry(
    () =>
      runInTransaction(async query => {
        if (options?.lockTimeoutMs != null && options.lockTimeoutMs > 0) {
          await query(`SET LOCAL lock_timeout = '${Math.floor(options.lockTimeoutMs)}ms'`);
        }
        await query(`SELECT pg_advisory_xact_lock($1)`, [TRACKING_PERSIST_ADVISORY_LOCK_KEY]);
        return body(query);
      }),
    options,
  );
}

/** Read-path: метрики / COUNT при конкуренции с L1 write. */
export async function withTrackingL1ReadRetry<T>(
  fn: () => Promise<T>,
  options?: { maxAttempts?: number; baseDelayMs?: number },
): Promise<T> {
  return withPgContendedReadRetry(fn, options);
}

export { isPgDeadlockError, isPgLockNotAvailableError };

/**
 * Полная очистка L1 (OLAP materialization). FK только внутри L1 (nodes→tracks).
 * consumed без FK на mat_parse_location — не блокируем OLTP при INSERT/TRUNCATE.
 */
export const TRACKING_RESET_TRUNCATE_SQL =
  `TRUNCATE TABLE state_track_strobe_member, state_track_strobe,
   state_track_consumed, mat_track_node, mat_track RESTART IDENTITY CASCADE`;

/**
 * Единый атомарный контракт rebuild: отменяет старые run, инвалидирует derived L1
 * и создаёт новый bounded drain в той же транзакции.
 */
export async function restartTrackingDrainTx(
  query: TrackingPgQueryFn,
  restart: TrackingDrainRestart,
): Promise<void> {
  await query(
    `UPDATE job_track_rebuild
     SET status = 'cancelled', finished_at = now(),
         control = COALESCE(control, '{}'::jsonb) || '{"cancel":true}'::jsonb
     WHERE status IN ('running', 'paused')`,
  );
  await query(TRACKING_RESET_TRUNCATE_SQL);
  // Сначала job, потом active_run_id — иначе FK tracking_pipeline_state_active_run_id_fkey.
  await query(
    `UPDATE state_track_pipeline
     SET watermark = '{}'::jsonb,
         flow_snapshot = '{"vectors":{},"mass":{}}'::jsonb,
         active_run_id = NULL, enabled = true,
         applied_config_revision = config_revision, updated_at = now()
     WHERE id = 'default'`,
  );
  await query(
    `INSERT INTO job_track_rebuild
     (id, status, mode, since, until, rebuild_gen, stats, started_at)
     VALUES ($1, 'running', 'full_rebuild', $2, $3, $4, $5::jsonb, $3)`,
    [
      restart.id,
      new Date(0).toISOString(),
      restart.startedAt,
      restart.rebuildGen,
      JSON.stringify({ stage: "loading", elapsedMs: 0 }),
    ],
  );
  await query(
    `UPDATE state_track_pipeline
     SET active_run_id = $1, updated_at = now()
     WHERE id = 'default'`,
    [restart.id],
  );
}
