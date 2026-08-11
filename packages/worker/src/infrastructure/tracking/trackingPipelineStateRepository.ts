/**
 * ---
 * layer: worker/infrastructure
 * domain: tracking
 * purpose: SQL-порты жизненного цикла инкрементального прогона (state_track_pipeline,
 *          job_track_rebuild) — используются runner platform-раннером трекинга
 *          (`application/tracking/runner/*`, runner-platform).
 *          Те же таблицы, что и у legacy `TrackingRebuildDaemon`, но раннеры взаимоисключающие
 *          (см. createWorkerCompositionRoot.ts) — гонки между ними нет.
 * ---
 */
import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";
import {
  resolveTrackingPipelineConfig,
  loadTrackingPipelineManifest,
  restartTrackingDrainTx,
  withTrackingL1Transaction,
  type TrackingPipelineConfig,
  type TrackingRebuildStats,
  type TrackingWatermark,
  type FlowMapSnapshot,
} from "@radar/shared";
import { MONOREPO_ROOT } from "@repo/root";

export type TrackingPipelineState = {
  enabled: boolean;
  watermark: TrackingWatermark | Record<string, never>;
  config: TrackingPipelineConfig;
  activeRunId: string | null;
  flowSnapshot: FlowMapSnapshot;
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
      flow_snapshot: FlowMapSnapshot | null;
    }[]
  >(
    `SELECT enabled, watermark, config, active_run_id, flow_snapshot
     FROM state_track_pipeline WHERE id = 'default'`,
  );
  return {
    enabled: row?.enabled ?? false,
    watermark: (row?.watermark as TrackingWatermark | undefined) ?? {},
    config: resolveTrackingPipelineConfig(
      loadTrackingPipelineManifest({ repoRoot: MONOREPO_ROOT }),
      row?.config ?? {},
    ),
    activeRunId: row?.active_run_id ?? null,
    flowSnapshot: row?.flow_snapshot ?? { vectors: {}, mass: {} },
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
    >(`SELECT id, rebuild_gen, status, started_at FROM job_track_rebuild WHERE id = $1`, [
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
        `UPDATE state_track_pipeline SET active_run_id = NULL, updated_at = now() WHERE id = 'default'`,
      );
    }
  }

  if (!hasPending) return null;

  const id = randomUUID();
  const rebuildGen = randomUUID();
  const since = isWatermark(state.watermark) ? state.watermark.lastOccurredAt : new Date(0).toISOString();
  const startedAt = new Date().toISOString();
  await ds.query(
    `INSERT INTO job_track_rebuild
     (id, status, mode, since, until, rebuild_gen, stats, started_at)
     VALUES ($1, 'running', 'incremental', $2, now(), $3, $4::jsonb, $5)`,
    [id, since, rebuildGen, JSON.stringify({ stage: "loading", elapsedMs: 0 }), startedAt],
  );
  await ds.query(
    `UPDATE state_track_pipeline SET active_run_id = $1, updated_at = now() WHERE id = 'default'`,
    [id],
  );
  return { id, rebuildGen, startedAt };
}

export async function readTrackingRunControl(
  ds: DataSource,
  runId: string,
): Promise<TrackingRunControl | null> {
  const [row] = await ds.query<{ control: TrackingRunControl | null }[]>(
    `SELECT control FROM job_track_rebuild WHERE id = $1`,
    [runId],
  );
  return row?.control ?? null;
}

export async function updateTrackingRunStats(
  ds: DataSource,
  runId: string,
  stats: Partial<TrackingRebuildStats>,
): Promise<void> {
  await ds.query(`UPDATE job_track_rebuild SET stats = stats || $1::jsonb WHERE id = $2`, [
    JSON.stringify(stats),
    runId,
  ]);
}

export async function advanceTrackingWatermark(
  ds: DataSource,
  watermark: TrackingWatermark,
  runId: string,
  totalCandidates: number,
  flowSnapshot?: FlowMapSnapshot,
): Promise<void> {
  await ds.query(
    `UPDATE state_track_pipeline
     SET watermark = $1::jsonb, total_candidates = $2,
         flow_snapshot = COALESCE($3::jsonb, flow_snapshot), updated_at = now()
     WHERE id = 'default'`,
    [JSON.stringify(watermark), totalCandidates, flowSnapshot ? JSON.stringify(flowSnapshot) : null],
  );
  await ds.query(`UPDATE job_track_rebuild SET checkpoint = $1::jsonb WHERE id = $2`, [
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
    `UPDATE job_track_rebuild
     SET status = 'done', finished_at = now(), stats = stats || $1::jsonb
     WHERE id = $2`,
    [JSON.stringify({ ...stats, stage: "done", pendingCandidates: remainingPending }), runId],
  );
  await ds.query(
    `UPDATE state_track_pipeline SET active_run_id = NULL, updated_at = now() WHERE id = 'default'`,
  );
}

export async function failTrackingRun(
  ds: DataSource,
  runId: string,
  error: string,
  elapsedMs: number,
): Promise<void> {
  await ds.query(
    `UPDATE job_track_rebuild
     SET status = 'failed', finished_at = now(), error = $1,
         stats = stats || $2::jsonb
     WHERE id = $3`,
    [error, JSON.stringify({ stage: "loading", elapsedMs }), runId],
  );
  await ds.query(
    `UPDATE state_track_pipeline SET active_run_id = NULL, updated_at = now() WHERE id = 'default'`,
  );
}

/** Каскадный сброс: watermark к началу, без re-enqueue и без перетасовки очереди. */
export async function resetTrackingWatermark(ds: DataSource): Promise<void> {
  await ds.query(
    `UPDATE state_track_pipeline
     SET watermark = '{}'::jsonb, flow_snapshot = '{"vectors":{},"mass":{}}'::jsonb, updated_at = now()
     WHERE id = 'default'`,
  );
}

/**
 * Единый старт rebuild: инвалидирует L1 и оставляет всю source-очередь pending.
 * Дальше её обрабатывает обычный bounded runner, без отдельного full-array алгоритма.
 */
export async function restartTrackingDrain(ds: DataSource): Promise<TrackingActiveRun> {
  const id = randomUUID();
  const rebuildGen = randomUUID();
  const startedAt = new Date().toISOString();

  await withTrackingL1Transaction(
    fn => ds.transaction(async em => fn((sql, params) => em.query(sql, params))),
    query => restartTrackingDrainTx(query, { id, rebuildGen, startedAt }),
  );

  return { id, rebuildGen, startedAt };
}

/**
 * Возвращает late-event temporal tail в единственный event-time поток.
 * Водяной знак пересчитается после replay; точки до границы остаются неизменным префиксом.
 */
export async function resetTrackingTemporalTail(ds: DataSource, since: Date): Promise<void> {
  const boundary = since.toISOString();
  await ds.transaction(async manager => {
    await manager.query(
      `DELETE FROM mat_track
       WHERE last_at >= $1`,
      [boundary],
    );
    await manager.query(
      `DELETE FROM state_track_consumed consumed
       USING mat_parse_location location
       JOIN mat_parse_event event ON event.id = location.parsed_event_id
       LEFT JOIN mat_ingest_raw raw_message ON raw_message.id = event.raw_message_id
       WHERE consumed.event_location_id = location.id
         AND COALESCE(location.occurred_at, raw_message.posted_at, event.parsed_at) >= $1`,
      [boundary],
    );
    await manager.query(
      `DELETE FROM state_track_strobe
       WHERE first_at >= $1 OR closes_at >= $1`,
      [boundary],
    );
    await manager.query(
      `UPDATE state_track_pipeline
       SET watermark = '{}'::jsonb, flow_snapshot = '{"vectors":{},"mass":{}}'::jsonb, updated_at = now()
       WHERE id = 'default'`,
    );
  });
}

function isWatermark(value: unknown): value is TrackingWatermark {
  if (!value || typeof value !== "object") return false;
  const w = value as Record<string, unknown>;
  return typeof w.lastOccurredAt === "string" && typeof w.lastEventLocationId === "string";
}
