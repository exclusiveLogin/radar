/**
 * ---
 * layer: worker/infrastructure
 * domain: tracking
 * purpose: SQL-порты жизненного цикла инкрементального прогона (tracking_pipeline_state,
 *          trajectory_rebuild_runs) — используются НОВЫМ runner platform-раннером трекинга
 *          (`application/tracking/runner/*`, за флагом `TRACKING_RUNNER_PLATFORM_ENABLED`).
 *          Те же таблицы, что и у legacy `TrackingRebuildDaemon`, но раннеры взаимоисключающие
 *          (см. createWorkerCompositionRoot.ts) — гонки между ними нет.
 * ---
 */
import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";
import {
  trackingPipelineConfigSchema,
  type TrackingPipelineConfig,
  type TrackingRebuildStats,
  type TrackingWatermark,
} from "@radar/shared";

export type TrackingPipelineState = {
  enabled: boolean;
  watermark: TrackingWatermark | Record<string, never>;
  config: TrackingPipelineConfig;
  activeRunId: string | null;
};

export type TrackingRunControl = { pause?: boolean; cancel?: boolean };

export type TrackingActiveRun = { id: string; rebuildGen: string; startedAt: string };

export async function readTrackingPipelineState(ds: DataSource): Promise<TrackingPipelineState> {
  const [row] = await ds.query<
    {
      enabled: boolean;
      watermark: unknown;
      config: unknown;
      active_run_id: string | null;
    }[]
  >(
    `SELECT enabled, watermark, config, active_run_id
     FROM tracking_pipeline_state WHERE id = 'default'`,
  );
  return {
    enabled: row?.enabled ?? false,
    watermark: (row?.watermark as TrackingWatermark | undefined) ?? {},
    config: trackingPipelineConfigSchema.parse(row?.config ?? {}),
    activeRunId: row?.active_run_id ?? null,
  };
}

/** Возвращает текущий running run либо создаёт новый (если есть pending); null — нечего делать. */
export async function ensureActiveTrackingRun(
  ds: DataSource,
  state: TrackingPipelineState,
  hasPending: boolean,
): Promise<TrackingActiveRun | null> {
  if (state.activeRunId) {
    const [run] = await ds.query<
      { id: string; rebuild_gen: string; status: string; started_at: string | Date }[]
    >(`SELECT id, rebuild_gen, status, started_at FROM trajectory_rebuild_runs WHERE id = $1`, [
      state.activeRunId,
    ]);
    if (run?.status === "running") {
      return {
        id: run.id,
        rebuildGen: run.rebuild_gen,
        startedAt: run.started_at instanceof Date ? run.started_at.toISOString() : String(run.started_at),
      };
    }
    if (run) {
      await ds.query(
        `UPDATE tracking_pipeline_state SET active_run_id = NULL, updated_at = now() WHERE id = 'default'`,
      );
    }
  }

  if (!hasPending) return null;

  const id = randomUUID();
  const rebuildGen = randomUUID();
  const since = isWatermark(state.watermark) ? state.watermark.lastOccurredAt : new Date(0).toISOString();
  const startedAt = new Date().toISOString();
  await ds.query(
    `INSERT INTO trajectory_rebuild_runs
     (id, status, mode, since, until, rebuild_gen, stats, started_at)
     VALUES ($1, 'running', 'incremental', $2, now(), $3, $4::jsonb, $5)`,
    [id, since, rebuildGen, JSON.stringify({ stage: "loading", elapsedMs: 0 }), startedAt],
  );
  await ds.query(
    `UPDATE tracking_pipeline_state SET active_run_id = $1, updated_at = now() WHERE id = 'default'`,
    [id],
  );
  return { id, rebuildGen, startedAt };
}

export async function readTrackingRunControl(
  ds: DataSource,
  runId: string,
): Promise<TrackingRunControl | null> {
  const [row] = await ds.query<{ control: TrackingRunControl | null }[]>(
    `SELECT control FROM trajectory_rebuild_runs WHERE id = $1`,
    [runId],
  );
  return row?.control ?? null;
}

export async function updateTrackingRunStats(
  ds: DataSource,
  runId: string,
  stats: Partial<TrackingRebuildStats>,
): Promise<void> {
  await ds.query(`UPDATE trajectory_rebuild_runs SET stats = stats || $1::jsonb WHERE id = $2`, [
    JSON.stringify(stats),
    runId,
  ]);
}

export async function advanceTrackingWatermark(
  ds: DataSource,
  watermark: TrackingWatermark,
  runId: string,
  totalCandidates: number,
): Promise<void> {
  await ds.query(
    `UPDATE tracking_pipeline_state
     SET watermark = $1::jsonb, total_candidates = $2, updated_at = now()
     WHERE id = 'default'`,
    [JSON.stringify(watermark), totalCandidates],
  );
  await ds.query(`UPDATE trajectory_rebuild_runs SET checkpoint = $1::jsonb WHERE id = $2`, [
    JSON.stringify(watermark),
    runId,
  ]);
}

export async function finishTrackingRun(
  ds: DataSource,
  runId: string,
  stats: Partial<TrackingRebuildStats>,
  remainingPending: number,
): Promise<void> {
  await ds.query(
    `UPDATE trajectory_rebuild_runs
     SET status = 'done', finished_at = now(), stats = stats || $1::jsonb
     WHERE id = $2`,
    [JSON.stringify({ ...stats, stage: "done", pendingCandidates: remainingPending }), runId],
  );
  await ds.query(
    `UPDATE tracking_pipeline_state SET active_run_id = NULL, updated_at = now() WHERE id = 'default'`,
  );
}

export async function failTrackingRun(
  ds: DataSource,
  runId: string,
  error: string,
  elapsedMs: number,
): Promise<void> {
  await ds.query(
    `UPDATE trajectory_rebuild_runs
     SET status = 'failed', finished_at = now(), error = $1,
         stats = stats || $2::jsonb
     WHERE id = $3`,
    [error, JSON.stringify({ stage: "loading", elapsedMs }), runId],
  );
  await ds.query(
    `UPDATE tracking_pipeline_state SET active_run_id = NULL, updated_at = now() WHERE id = 'default'`,
  );
}

/** Каскадный сброс: watermark к началу, без re-enqueue и без перетасовки очереди. */
export async function resetTrackingWatermark(ds: DataSource): Promise<void> {
  await ds.query(
    `UPDATE tracking_pipeline_state SET watermark = '{}'::jsonb, updated_at = now() WHERE id = 'default'`,
  );
}

function isWatermark(value: unknown): value is TrackingWatermark {
  if (!value || typeof value !== "object") return false;
  const w = value as Record<string, unknown>;
  return typeof w.lastOccurredAt === "string" && typeof w.lastEventLocationId === "string";
}
