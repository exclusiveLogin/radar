import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import {
  resolveTrackingPipelineStatus,
  TRACKING_PIPELINE_NOT_PROCESSED_SQL,
  TRACKING_PERSIST_ADVISORY_LOCK_KEY,
  TRACKING_RESET_TRUNCATE_SQL,
  maxEpsilonTemporalMs,
  resolveDaemonBatchSize,
  resolveNextGenDaemonBatchSize,
  withTrackingL1Transaction,
  withTrackingL1ReadRetry,
  isPgContendedL1ResetError,
  trackingPipelineConfigSchema,
  trackingStatusResponseSchema,
  trackingTargetEventTypesSqlIn,
  trackingTuneRunSchema,
  trackingTuneStartRequestSchema,
  withPgContendedReadRetry,
  type TrackingPipelineConfig,
  type TrackingPipelineMetrics,
  type TrackingRebuildRun,
  type TrackingStatusResponse,
  type TrackingTuneRun,
  type TrackingWatermark,
} from "@radar/shared";
import type { DataSource } from "typeorm";
import { randomUUID } from "crypto";
import { TrackingL1ResetGate } from "../tracking/tracking-l1-reset.gate";
import {
  pgTimestampToIso,
  pgTimestampToIsoOptional,
} from "../infrastructure/persistence/typeorm-query-rows";

type PipelineRow = {
  enabled: boolean;
  watermark: TrackingWatermark | Record<string, never>;
  config: TrackingPipelineConfig;
  active_run_id: string | null;
  total_candidates: string | null;
};

type RunRow = {
  id: string;
  started_at: Date | string;
  finished_at: Date | string | null;
  status: string;
  mode: string;
  since: Date | string;
  until: Date | string;
  rebuild_gen: string;
  stats: Record<string, unknown>;
  checkpoint: TrackingWatermark | null;
  control: { pause?: boolean; cancel?: boolean } | null;
  error: string | null;
};

type TuneRunRow = {
  id: string;
  status: string;
  params_in: Record<string, unknown>;
  epochs_done: number;
  max_epochs: number;
  best_config: Record<string, unknown> | null;
  best_fitness: number | null;
  grid: Record<string, unknown>[];
  error: string | null;
  created_at: Date | string;
  finished_at: Date | string | null;
};

const DEFAULT_CONFIG = trackingPipelineConfigSchema.parse({});
const EVENT_AT_SQL = "COALESCE(el.occurred_at, rm.posted_at, pe.parsed_at)";

const NOT_PROCESSED_SQL = TRACKING_PIPELINE_NOT_PROCESSED_SQL;

/** Админка пайплайна треков: статус, runs, управление daemon. */
@Injectable()
export class TrackingAdminService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly l1ResetGate: TrackingL1ResetGate,
  ) {}

  async getStatus(): Promise<TrackingStatusResponse> {
    const [state] = await this.ds.query<PipelineRow[]>(
      `SELECT enabled, watermark, config, active_run_id, total_candidates
       FROM tracking_pipeline_state WHERE id = 'default'`,
    );
    const pipeline = state ?? {
      enabled: false,
      watermark: {},
      config: DEFAULT_CONFIG,
      active_run_id: null,
      total_candidates: null,
    };

    const runId = pipeline.active_run_id ?? null;
    const activeRun = await this.resolveControllableRun(runId);
    const [lastRunRow] = await this.ds.query<RunRow[]>(
      `SELECT * FROM trajectory_rebuild_runs ORDER BY started_at DESC LIMIT 1`,
    );
    const lastRun = lastRunRow ? mapRunRow(lastRunRow) : null;

    const control = activeRun ? await this.readRunControl(activeRun.id) : null;
    const until = new Date();
    const config = mergeConfig(pipeline.config);

    /** Во время run/reset тяжёлые COUNT блокируют пул API — отдаём stats из run. */
    const metricsLite =
      activeRun?.status === "running"
      || activeRun?.status === "paused"
      || this.l1ResetGate.isPaused();

    let totalTracks = 0;
    let metrics: TrackingPipelineMetrics;
    if (metricsLite) {
      metrics = this.buildLiteMetrics(activeRun, config);
      if (!this.l1ResetGate.isPaused()) {
        try {
          totalTracks = await this.countTracksSafe();
        } catch {
          totalTracks = metrics.tracksTotal;
        }
      }
    } else {
      totalTracks = await this.countTracksSafe();
      metrics = await this.collectMetrics(until, activeRun, config);
    }

    /** SSOT прогресса: во время run — % пайплайна из stats, иначе покрытие нодами. */
    const totalCandidates = metrics.totalTargetCandidates;
    const percentApprox = metricsLite
      ? (activeRun?.stats?.percentApprox ?? metrics.percentPipelineProcessed)
      : metrics.percentNodesInTracks;

    const watermark = isWatermark(pipeline.watermark) ? pipeline.watermark : null;
    const remainingCandidates = pipeline.enabled
      ? (activeRun?.stats?.pendingCandidates ?? metrics.unconsumedPipeline)
      : 0;
    const pipelineStatus = resolveTrackingPipelineStatus({
      enabled: pipeline.enabled,
      paused: control?.pause === true,
      activeRun,
      lastRun,
      remainingCandidates,
    });

    return trackingStatusResponseSchema.parse({
      enabled: pipeline.enabled,
      paused: control?.pause === true,
      daemonRunning: activeRun?.status === "running",
      pipelineStatus,
      activeRun,
      lastRun,
      watermark,
      totalTracks: Number(totalTracks),
      totalCandidates,
      percentApprox,
      metrics,
      config,
    });
  }

  /** Необработанные pipeline-точки (SSOT: worker countTrackingPipelineRemaining). */
  private async countUnconsumedPipeline(until: Date): Promise<number> {
    return withPgContendedReadRetry(async () => {
      const targetIn = trackingTargetEventTypesSqlIn();

      const [{ count }] = await this.ds.query<{ count: string }[]>(
        `
      SELECT COUNT(*)::text AS count
      FROM event_locations el
      JOIN parsed_events pe ON pe.id = el.parsed_event_id
      LEFT JOIN raw_messages rm ON rm.id = pe.raw_message_id
      WHERE
        ${EVENT_AT_SQL} <= $1
        AND el.lat IS NOT NULL
        AND el.lon IS NOT NULL
        AND pe.is_active IS DISTINCT FROM false
        AND pe.event_type IN (${targetIn})
        ${NOT_PROCESSED_SQL}
      `,
        [until.toISOString()],
      );
      return Number(count);
    });
  }

  async listRuns(limit = 20): Promise<TrackingRebuildRun[]> {
    const rows = await this.ds.query<RunRow[]>(
      `SELECT * FROM trajectory_rebuild_runs ORDER BY started_at DESC LIMIT $1`,
      [limit],
    );
    return rows.map(mapRunRow);
  }

  async getConfig(): Promise<TrackingPipelineConfig> {
    const [state] = await this.ds.query<PipelineRow[]>(
      `SELECT config FROM tracking_pipeline_state WHERE id = 'default'`,
    );
    return mergeConfig(state?.config);
  }

  async patchConfig(body: unknown): Promise<TrackingPipelineConfig> {
    const patch = trackingPipelineConfigSchema.partial().parse(body);
    const current = await this.getConfig();
    const next = trackingPipelineConfigSchema.parse({
      ...current,
      ...patch,
      profiles: patch.profiles
        ? mergeProfileOverrides(current.profiles, patch.profiles)
        : current.profiles,
    });
    await this.ds.query(
      `UPDATE tracking_pipeline_state SET config = $1::jsonb, updated_at = now() WHERE id = 'default'`,
      [JSON.stringify(next)],
    );
    return next;
  }

  async patchEnabled(enabled: boolean): Promise<{ ok: true; enabled: boolean }> {
    await this.ds.query(
      `UPDATE tracking_pipeline_state SET enabled = $1, updated_at = now() WHERE id = 'default'`,
      [enabled],
    );
    if (enabled) {
      const until = new Date();
      const remaining = await this.countUnconsumedPipeline(until);
      if (remaining > 0) {
        const runId = await this.resolveControllableRunId();
        if (!runId) {
          const id = await this.createRun("incremental");
          await this.bindActiveRun(id);
        }
      }
    }
    return { ok: true, enabled };
  }

  async rebuild(): Promise<{ ok: true; runId: string }> {
    await this.resetInternal();
    try {
      const runId = await this.createRun("full_rebuild");
      await this.ds.query(
        `UPDATE tracking_pipeline_state SET active_run_id = $1, enabled = true, updated_at = now() WHERE id = 'default'`,
        [runId],
      );
      return { ok: true, runId };
    } catch (err) {
      await this.ensurePipelineEnabled();
      throw err;
    }
  }

  /**
   * Soft rebuild: truncate L1 + consumed, watermark с нуля, config не трогаем.
   * Worker заново: Phase W (magnet/gravity/corridor из event_locations) → Phase A (GNN assign).
   */
  async softRebuild(): Promise<{ ok: true; runId: string }> {
    await this.softResetInternal();
    try {
      const runId = await this.createRun("soft_rebuild");
      await this.ds.query(
        `UPDATE tracking_pipeline_state SET active_run_id = $1, enabled = true, updated_at = now() WHERE id = 'default'`,
        [runId],
      );
      return { ok: true, runId };
    } catch (err) {
      await this.ensurePipelineEnabled();
      throw err;
    }
  }

  async reset(): Promise<{ ok: true }> {
    await this.resetInternal();
    return { ok: true };
  }

  async pause(): Promise<{ ok: true }> {
    let runId = await this.resolveControllableRunId();
    if (!runId) {
      const [{ enabled }] = await this.ds.query<{ enabled: boolean }[]>(
        `SELECT enabled FROM tracking_pipeline_state WHERE id = 'default'`,
      );
      if (!enabled) throw new BadRequestException("pipeline disabled");
      runId = await this.createRun("incremental");
      await this.bindActiveRun(runId);
    }
    await this.setRunControl(runId, { pause: true });
    await this.ds.query(
      `UPDATE trajectory_rebuild_runs SET status = 'paused' WHERE id = $1`,
      [runId],
    );
    return { ok: true };
  }

  async resume(): Promise<{ ok: true }> {
    const runId = await this.resolveControllableRunId();
    if (!runId) throw new BadRequestException("no pausable run");
    const run = await this.loadRun(runId);
    if (!run || run.status !== "paused") {
      throw new BadRequestException("run is not paused");
    }
    await this.setRunControl(runId, { pause: false });
    await this.ds.query(
      `UPDATE trajectory_rebuild_runs SET status = 'running' WHERE id = $1`,
      [runId],
    );
    return { ok: true };
  }

  async cancel(): Promise<{ ok: true }> {
    const runId = await this.resolveControllableRunId();
    if (!runId) throw new BadRequestException("no active run");
    await this.setRunControl(runId, { cancel: true });
    await this.ds.query(
      `UPDATE trajectory_rebuild_runs SET status = 'cancelled', finished_at = now() WHERE id = $1`,
      [runId],
    );
    await this.ds.query(
      `UPDATE tracking_pipeline_state SET active_run_id = NULL, updated_at = now() WHERE id = 'default'`,
    );
    return { ok: true };
  }

  // ─── Tune runs ───────────────────────────────────────────────────────────

  async listTuneRuns(limit = 20): Promise<TrackingTuneRun[]> {
    const rows = await this.ds.query<TuneRunRow[]>(
      `SELECT * FROM tracking_tune_runs ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return rows.map(mapTuneRunRow);
  }

  async getTuneRun(id: string): Promise<TrackingTuneRun> {
    const [row] = await this.ds.query<TuneRunRow[]>(
      `SELECT * FROM tracking_tune_runs WHERE id = $1`,
      [id],
    );
    if (!row) throw new NotFoundException(`Tune run ${id} not found`);
    return mapTuneRunRow(row);
  }

  async startTune(body: unknown): Promise<TrackingTuneRun> {
    const params = trackingTuneStartRequestSchema.parse(body);
    const [row] = await this.ds.query<TuneRunRow[]>(
      `INSERT INTO tracking_tune_runs (status, params_in, max_epochs)
       VALUES ('running', $1::jsonb, $2)
       RETURNING *`,
      [JSON.stringify(params), params.maxEpochs ?? 12],
    );
    return mapTuneRunRow(row);
  }

  async cancelTune(id: string): Promise<{ ok: true }> {
    const run = await this.getTuneRun(id);
    if (run.status !== "running") {
      throw new BadRequestException(`Tune run ${id} is not running (status: ${run.status})`);
    }
    await this.ds.query(
      `UPDATE tracking_tune_runs
       SET status = 'cancelled', finished_at = now(), control = control || '{"cancel":true}'::jsonb
       WHERE id = $1`,
      [id],
    );
    return { ok: true };
  }

  async restartTune(id: string): Promise<TrackingTuneRun> {
    const run = await this.getTuneRun(id);
    if (run.status === "running") {
      throw new BadRequestException("Cannot restart a running tune run");
    }
    const [row] = await this.ds.query<TuneRunRow[]>(
      `INSERT INTO tracking_tune_runs (status, params_in, max_epochs)
       VALUES ('running', $1::jsonb, $2)
       RETURNING *`,
      [JSON.stringify(run.paramsIn), run.maxEpochs],
    );
    return mapTuneRunRow(row);
  }

  async applyTune(id: string): Promise<TrackingPipelineConfig> {
    const run = await this.getTuneRun(id);
    if (!run.bestConfig) {
      throw new BadRequestException(`Tune run ${id} has no best config to apply`);
    }
    return this.patchConfig(run.bestConfig);
  }

  async deleteTune(id: string): Promise<{ ok: true }> {
    const run = await this.getTuneRun(id);
    if (run.status === "running") {
      throw new BadRequestException("Cannot delete a running tune run; cancel it first");
    }
    await this.ds.query(`DELETE FROM tracking_tune_runs WHERE id = $1`, [id]);
    return { ok: true };
  }

  // ─────────────────────────────────────────────────────────────────────────

  private async ensurePipelineEnabled(): Promise<void> {
    await this.ds.query(
      `UPDATE tracking_pipeline_state SET enabled = true, updated_at = now() WHERE id = 'default'`,
    );
  }

  private async resetInternal(): Promise<void> {
    await this.runL1Reset(async () => {
      await this.cancelActiveRuns();
      await this.ds.query(
        `UPDATE tracking_pipeline_state
         SET enabled = false, active_run_id = NULL, updated_at = now()
         WHERE id = 'default'`,
      );
      await this.waitTrackingMutationsIdle(45_000);
      await this.waitL1ReadsIdle(8_000);
      await this.terminateL1WriteBlockers();
      await sleepMs(300);
      await this.truncateTracksQueueInternal();
    });
  }

  /** Truncate L1 + consumed и watermark без выключения enabled (soft rebuild). */
  private async softResetInternal(): Promise<void> {
    await this.runL1Reset(async () => {
      await this.cancelActiveRuns();
      await this.ds.query(
        `UPDATE tracking_pipeline_state
         SET enabled = false, active_run_id = NULL, updated_at = now()
         WHERE id = 'default'`,
      );
      await this.waitTrackingMutationsIdle(45_000);
      await this.waitL1ReadsIdle(8_000);
      await this.terminateL1WriteBlockers();
      await sleepMs(300);
      await this.truncateTracksQueueInternal();
    });
  }

  /** Блокируем map read L1; после reset — resume (даже при ошибке). */
  private async runL1Reset(body: () => Promise<void>): Promise<void> {
    this.l1ResetGate.pause();
    try {
      await body();
    } finally {
      this.l1ResetGate.resume();
    }
  }

  /** Ждём завершения in-flight L1 WRITE (read-локи COUNT игнорируем). */
  private async waitTrackingMutationsIdle(maxMs = 30_000): Promise<void> {
    const stepMs = 250;
    for (let waited = 0; waited < maxMs; waited += stepMs) {
      const [row] = await this.ds.query<{ count: string }[]>(
        `
        SELECT COUNT(*)::text AS count
        FROM pg_locks l
        JOIN pg_class c ON c.oid = l.relation
        WHERE c.relname IN ('trajectory_tracks', 'trajectory_nodes', 'tracking_pipeline_consumed')
          AND l.granted
          AND l.mode IN ('RowExclusiveLock', 'ShareLock', 'ShareRowExclusiveLock',
                         'ExclusiveLock', 'AccessExclusiveLock')
          AND l.pid <> pg_backend_pid()
        `,
      );
      if (Number(row?.count ?? 0) === 0) return;
      await sleepMs(stepMs);
    }
  }

  /** Ждём завершения in-flight map SELECT (AccessShareLock). */
  private async waitL1ReadsIdle(maxMs = 8_000): Promise<void> {
    const stepMs = 200;
    for (let waited = 0; waited < maxMs; waited += stepMs) {
      const [row] = await this.ds.query<{ count: string }[]>(
        `
        SELECT COUNT(*)::text AS count
        FROM pg_locks l
        JOIN pg_class c ON c.oid = l.relation
        WHERE c.relname IN ('trajectory_tracks', 'trajectory_nodes', 'tracking_pipeline_consumed')
          AND l.granted
          AND l.mode = 'AccessShareLock'
          AND l.pid <> pg_backend_pid()
        `,
      );
      if (Number(row?.count ?? 0) === 0) return;
      await sleepMs(stepMs);
    }
  }

  /**
   * Отменяем активные SELECT по L1 — соединение пула живёт, lock снимается.
   * Не используем pg_terminate_backend: иначе падают ingest/admin на том же пуле.
   */
  private async cancelL1ReadBlockers(): Promise<void> {
    await this.ds.query(
      `
      SELECT pg_cancel_backend(s.pid)
      FROM (
        SELECT DISTINCT l.pid
        FROM pg_locks l
        JOIN pg_class c ON c.oid = l.relation
        WHERE l.pid <> pg_backend_pid()
          AND l.granted
          AND c.relname IN ('trajectory_tracks', 'trajectory_nodes', 'tracking_pipeline_consumed')
          AND l.mode = 'AccessShareLock'
      ) s
      `,
    );
  }

  /** Worker persist / L1 WRITE — terminate допустим (переподключится). */
  private async terminateL1WriteBlockers(): Promise<void> {
    await this.ds.query(
      `
      SELECT pg_terminate_backend(s.pid)
      FROM (
        SELECT DISTINCT l.pid
        FROM pg_locks l
        LEFT JOIN pg_class c ON c.oid = l.relation
        WHERE l.pid <> pg_backend_pid()
          AND l.granted
          AND (
            (l.locktype = 'advisory' AND l.objid = $1)
            OR (
              c.relname IN ('trajectory_tracks', 'trajectory_nodes', 'tracking_pipeline_consumed')
              AND l.mode IN ('RowExclusiveLock', 'ShareLock', 'ShareRowExclusiveLock',
                             'ExclusiveLock', 'AccessExclusiveLock')
            )
          )
      ) s
      `,
      [TRACKING_PERSIST_ADVISORY_LOCK_KEY],
    );
  }

  /** Общий сброс очереди assign: TRUNCATE + watermark {} под xact advisory lock. */
  private async truncateTracksQueueInternal(): Promise<void> {
    const lockTimeoutMs = 30_000;
    let lastError: unknown;
    for (let attempt = 1; attempt <= 8; attempt++) {
      try {
        await withTrackingL1Transaction(
          fn => this.ds.transaction(async em => fn((sql, params) => em.query(sql, params))),
          async query => {
            await query(TRACKING_RESET_TRUNCATE_SQL);
            await query(
              `UPDATE tracking_pipeline_state
               SET watermark = '{}'::jsonb, updated_at = now()
               WHERE id = 'default'`,
            );
          },
          { maxAttempts: 3, baseDelayMs: 200, lockTimeoutMs },
        );
        return;
      } catch (error) {
        lastError = error;
        if (!isPgContendedL1ResetError(error)) {
          throw error;
        }
        await this.cancelL1ReadBlockers();
        await this.terminateL1WriteBlockers();
        await sleepMs(500 * attempt);
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("truncate L1: не удалось получить lock после terminate");
  }

  private async cancelActiveRuns(): Promise<void> {
    await this.ds.query(
      `UPDATE trajectory_rebuild_runs
       SET status = 'cancelled', finished_at = now(),
           control = COALESCE(control, '{}'::jsonb) || '{"cancel":true}'::jsonb
       WHERE status IN ('running', 'paused')`,
    );
  }

  private async createRun(
    mode: "incremental" | "full_rebuild" | "soft_rebuild",
  ): Promise<string> {
    const id = randomUUID();
    const rebuildGen = randomUUID();
    const since = new Date(0).toISOString();
    const until = new Date().toISOString();
    await this.ds.query(
      `INSERT INTO trajectory_rebuild_runs
       (id, status, mode, since, until, rebuild_gen, stats)
       VALUES ($1, 'running', $2, $3, $4, $5, $6::jsonb)`,
      [id, mode, since, until, rebuildGen, JSON.stringify({ stage: "loading", elapsedMs: 0 })],
    );
    return id;
  }

  private async bindActiveRun(runId: string): Promise<void> {
    await this.ds.query(
      `UPDATE tracking_pipeline_state SET active_run_id = $1, updated_at = now() WHERE id = 'default'`,
      [runId],
    );
  }

  /** running/paused run: active_run_id или последний controllable run в БД. */
  private async resolveControllableRunId(): Promise<string | null> {
    const [state] = await this.ds.query<{ active_run_id: string | null }[]>(
      `SELECT active_run_id FROM tracking_pipeline_state WHERE id = 'default'`,
    );
    const run = await this.resolveControllableRun(state?.active_run_id ?? null);
    return run?.id ?? null;
  }

  private async resolveControllableRun(
    preferredId: string | null,
  ): Promise<TrackingRebuildRun | null> {
    if (preferredId) {
      const preferred = await this.loadRun(preferredId);
      if (preferred && (preferred.status === "running" || preferred.status === "paused")) {
        return preferred;
      }
    }
    const [row] = await this.ds.query<RunRow[]>(
      `SELECT * FROM trajectory_rebuild_runs
       WHERE status IN ('running', 'paused')
       ORDER BY started_at DESC
       LIMIT 1`,
    );
    return row ? mapRunRow(row) : null;
  }

  private async loadRun(id: string): Promise<TrackingRebuildRun | null> {
    const [row] = await this.ds.query<RunRow[]>(
      `SELECT * FROM trajectory_rebuild_runs WHERE id = $1`,
      [id],
    );
    return row ? mapRunRow(row) : null;
  }

  private async readRunControl(runId: string) {
    const [row] = await this.ds.query<{ control: RunRow["control"] }[]>(
      `SELECT control FROM trajectory_rebuild_runs WHERE id = $1`,
      [runId],
    );
    return row?.control ?? null;
  }

  private async setRunControl(
    runId: string,
    patch: { pause?: boolean; cancel?: boolean },
  ): Promise<void> {
    const current = (await this.readRunControl(runId)) ?? {};
    await this.ds.query(
      `UPDATE trajectory_rebuild_runs SET control = $1::jsonb WHERE id = $2`,
      [JSON.stringify({ ...current, ...patch }), runId],
    );
  }

  /** Безопасный COUNT треков — retry при конкуренции с worker persist. */
  private async countTracksSafe(): Promise<number> {
    return withTrackingL1ReadRetry(async () => {
      const [{ count }] = await this.ds.query<{ count: string }[]>(
        `SELECT COUNT(*)::text AS count FROM trajectory_tracks`,
      );
      return Number(count);
    }, { maxAttempts: 3, baseDelayMs: 120 });
  }

  /**
   * Лёгкие метрики из stats активного run — без OLTP/L1 COUNT.
   * Иначе pollTrackingStatus (3 с) висит на lock и «убивает» API.
   */
  private buildLiteMetrics(
    activeRun: TrackingRebuildRun | null,
    config: TrackingPipelineConfig,
  ): TrackingPipelineMetrics {
    const stats = activeRun?.stats ?? {};
    const totalTargetCandidates = stats.totalCandidates ?? 0;
    const processedCandidates = stats.processedCandidates ?? 0;
    const unconsumedPipeline = Math.max(0, totalTargetCandidates - processedCandidates);
    const percentPipelineProcessed =
      stats.percentApprox
      ?? (totalTargetCandidates > 0
        ? Math.min(100, Math.round((processedCandidates / totalTargetCandidates) * 100))
        : 0);
    const runStartedAt = activeRun?.startedAt ?? null;
    const elapsedMs =
      stats.elapsedMs
      ?? (runStartedAt && activeRun?.status === "running"
        ? Math.max(0, Date.now() - new Date(runStartedAt).getTime())
        : undefined);
    const effectiveBatchSize =
      stats.batchSize
      ?? (config.associationAlgorithm === "nextgen-gravity"
        ? resolveNextGenDaemonBatchSize(config.batchSize)
        : resolveDaemonBatchSize(config.batchSize));
    const tracksActive = stats.kalmanTracksOpen ?? 0;
    const tracksClosed = stats.kalmanTracksClosed ?? 0;

    return {
      totalCandidatesGeo: totalTargetCandidates,
      totalTargetCandidates,
      unconsumedPipeline,
      dedupClosureSize: stats.dedupClosureSize,
      effectiveBatchSize,
      processedCandidates,
      percentProcessed: percentPipelineProcessed,
      percentPipelineProcessed,
      nodesInTracks: 0,
      percentNodesInTracks: 0,
      tracksActive,
      tracksClosed,
      tracksStale: 0,
      tracksTotal: tracksActive + tracksClosed,
      elapsedMs,
      runStartedAt,
    };
  }

  /** Агрегированные метрики: целевые точки, % в треках, статусы треков, время run. */
  private async collectMetrics(
    until: Date,
    activeRun: TrackingRebuildRun | null,
    config: TrackingPipelineConfig,
  ): Promise<TrackingPipelineMetrics> {
    return withTrackingL1ReadRetry(async () => {
    const [{ count: geoCount }] = await this.ds.query<{ count: string }[]>(
      `
      SELECT COUNT(*)::text AS count
      FROM event_locations el
      JOIN parsed_events pe ON pe.id = el.parsed_event_id
      LEFT JOIN raw_messages rm ON rm.id = pe.raw_message_id
      WHERE ${EVENT_AT_SQL} <= $1
        AND el.lat IS NOT NULL AND el.lon IS NOT NULL
        AND pe.is_active IS DISTINCT FROM false
      `,
      [until.toISOString()],
    );

    const targetIn = trackingTargetEventTypesSqlIn();
    const [{ count: targetCount }] = await this.ds.query<{ count: string }[]>(
      `
      SELECT COUNT(*)::text AS count
      FROM event_locations el
      JOIN parsed_events pe ON pe.id = el.parsed_event_id
      LEFT JOIN raw_messages rm ON rm.id = pe.raw_message_id
      WHERE ${EVENT_AT_SQL} <= $1
        AND el.lat IS NOT NULL AND el.lon IS NOT NULL
        AND pe.is_active IS DISTINCT FROM false
        AND pe.event_type IN (${targetIn})
      `,
      [until.toISOString()],
    );

    const [{ nodes }] = await this.ds.query<{ nodes: string }[]>(
      `SELECT COUNT(*)::text AS nodes FROM trajectory_nodes`,
    );

    const trackRows = await this.ds.query<{ status: string; count: string }[]>(
      `SELECT status, COUNT(*)::text AS count FROM trajectory_tracks GROUP BY status`,
    );
    const byStatus = Object.fromEntries(trackRows.map(r => [r.status, Number(r.count)]));
    const tracksActive = byStatus.active ?? 0;
    const tracksClosed = byStatus.closed ?? 0;
    const tracksStale = byStatus.stale ?? 0;

    const totalTargetCandidates = Number(targetCount);
    const nodesInTracks = Number(nodes);
    const unconsumedPipeline = await this.countUnconsumedPipeline(until);
    const dedupClosureSize = await this.countDedupClosureSize(until, config, unconsumedPipeline);
    const effectiveBatchSize = resolveDaemonBatchSize(config.batchSize);
    const percentNodesInTracks =
      totalTargetCandidates > 0
        ? Math.min(100, Math.round((nodesInTracks / totalTargetCandidates) * 100))
        : 0;
    const percentPipelineProcessed =
      totalTargetCandidates > 0
        ? Math.min(
            100,
            Math.round(((totalTargetCandidates - unconsumedPipeline) / totalTargetCandidates) * 100),
          )
        : 0;

    const runStartedAt = activeRun?.startedAt ?? null;
    const elapsedMs =
      runStartedAt && activeRun?.status === "running"
        ? Math.max(0, Date.now() - new Date(runStartedAt).getTime())
        : activeRun?.stats?.elapsedMs;

    return {
      totalCandidatesGeo: Number(geoCount),
      totalTargetCandidates,
      unconsumedPipeline,
      dedupClosureSize,
      effectiveBatchSize,
      processedCandidates: totalTargetCandidates - unconsumedPipeline,
      percentProcessed: percentPipelineProcessed,
      percentPipelineProcessed,
      nodesInTracks,
      percentNodesInTracks,
      tracksActive,
      tracksClosed,
      tracksStale,
      tracksTotal: tracksActive + tracksClosed + tracksStale,
      elapsedMs,
      runStartedAt,
    };
    });
  }

  /**
   * Live-размер dedup closure: pending ∪ consumed-якоря в окне ε_temporal.
   * Pending и anchors не пересекаются → сумма.
   */
  private async countDedupClosureSize(
    until: Date,
    config: TrackingPipelineConfig,
    unconsumedPipeline: number,
  ): Promise<number> {
    if (unconsumedPipeline === 0) return 0;

    const targetIn = trackingTargetEventTypesSqlIn();
    const lookbackMs = maxEpsilonTemporalMs(config.profiles);

    const [minRow] = await this.ds.query<{ min_at: Date | string | null }[]>(
      `
      SELECT MIN(${EVENT_AT_SQL}) AS min_at
      FROM event_locations el
      JOIN parsed_events pe ON pe.id = el.parsed_event_id
      LEFT JOIN raw_messages rm ON rm.id = pe.raw_message_id
      WHERE
        ${EVENT_AT_SQL} <= $1
        AND el.lat IS NOT NULL
        AND el.lon IS NOT NULL
        AND pe.is_active IS DISTINCT FROM false
        AND pe.event_type IN (${targetIn})
        ${NOT_PROCESSED_SQL}
      `,
      [until.toISOString()],
    );

    const minAt = minRow?.min_at ? new Date(minRow.min_at) : until;
    const lookbackSince = new Date(minAt.getTime() - lookbackMs);

    const [{ count: anchorCount }] = await this.ds.query<{ count: string }[]>(
      `
      SELECT COUNT(*)::text AS count
      FROM event_locations el
      JOIN parsed_events pe ON pe.id = el.parsed_event_id
      LEFT JOIN raw_messages rm ON rm.id = pe.raw_message_id
      WHERE
        ${EVENT_AT_SQL} <= $1
        AND ${EVENT_AT_SQL} >= $2
        AND el.lat IS NOT NULL
        AND el.lon IS NOT NULL
        AND pe.is_active IS DISTINCT FROM false
        AND pe.event_type IN (${targetIn})
        AND EXISTS (
          SELECT 1 FROM tracking_pipeline_consumed tpc
          WHERE tpc.event_location_id = el.id
        )
      `,
      [until.toISOString(), lookbackSince.toISOString()],
    );

    return unconsumedPipeline + Number(anchorCount);
  }
}

function isWatermark(value: unknown): value is TrackingWatermark {
  if (!value || typeof value !== "object") return false;
  const w = value as Record<string, unknown>;
  return typeof w.lastOccurredAt === "string" && typeof w.lastEventLocationId === "string";
}

function mergeConfig(raw: unknown): TrackingPipelineConfig {
  return trackingPipelineConfigSchema.parse({ ...DEFAULT_CONFIG, ...(raw as object) });
}

/** Глубокий merge overrides по профилям — patch одного профиля не затирает остальные. */
function mergeProfileOverrides(
  current: TrackingPipelineConfig["profiles"],
  patch: NonNullable<TrackingPipelineConfig["profiles"]>,
): TrackingPipelineConfig["profiles"] {
  const merged = { ...current };
  for (const [key, profilePatch] of Object.entries(patch)) {
    const profile = key as keyof typeof patch;
    merged[profile] = { ...merged[profile], ...profilePatch };
  }
  return merged;
}

function mapTuneRunRow(row: TuneRunRow): TrackingTuneRun {
  return trackingTuneRunSchema.parse({
    id: row.id,
    status: row.status,
    paramsIn: row.params_in,
    epochsDone: row.epochs_done,
    maxEpochs: row.max_epochs,
    bestConfig: row.best_config,
    bestFitness: row.best_fitness,
    grid: row.grid,
    error: row.error,
    createdAt: pgTimestampToIso(row.created_at),
    finishedAt: pgTimestampToIsoOptional(row.finished_at) ?? null,
  });
}

function mapRunRow(row: RunRow): TrackingRebuildRun {
  return {
    id: row.id,
    status: row.status as TrackingRebuildRun["status"],
    mode: row.mode as TrackingRebuildRun["mode"],
    startedAt: pgTimestampToIso(row.started_at),
    finishedAt: pgTimestampToIsoOptional(row.finished_at) ?? null,
    since: pgTimestampToIso(row.since),
    until: pgTimestampToIso(row.until),
    rebuildGen: row.rebuild_gen,
    stats: row.stats ?? {},
    checkpoint: row.checkpoint ?? null,
    error: row.error,
  };
}

function sleepMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
