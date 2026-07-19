import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import {
  DEFAULT_TRACKING_STEP_MANIFEST,
  resolveTrackingPipelineStatus,
  TRACKING_PIPELINE_NOT_PROCESSED_SQL,
  TRACKING_PERSIST_ADVISORY_LOCK_KEY,
  TRACKING_RESET_TRUNCATE_SQL,
  maxEpsilonTemporalMs,
  resolveDaemonBatchSize,
  withTrackingL1Transaction,
  withTrackingL1ReadRetry,
  isPgContendedL1ResetError,
  trackingPipelineConfigSchema,
  trackingStatusResponseSchema,
  trackingTargetEventTypesSqlIn,
  withPgContendedReadRetry,
  type TrackingPipelineConfig,
  type TrackingPipelineMetrics,
  type TrackingRebuildRun,
  type TrackingStatusResponse,
  type TrackingWatermark,
} from "@radar/shared";
import type { DataSource } from "typeorm";
import { randomUUID } from "crypto";
import { TrackingL1ResetGate } from "../tracking/tracking-l1-reset.gate";
import type {
  TrackingAdminCommandPort,
  TrackingRebuildMode,
} from "../application/tracking-admin/tracking-admin-commands";
import {
  pgTimestampToIso,
  pgTimestampToIsoOptional,
} from "@radar/persistence";

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

const DEFAULT_CONFIG = trackingPipelineConfigSchema.parse({});
const EVENT_AT_SQL = "COALESCE(el.occurred_at, rm.posted_at, pe.parsed_at)";

const NOT_PROCESSED_SQL = TRACKING_PIPELINE_NOT_PROCESSED_SQL;

/** PostgreSQL adapter read-модели и команд tracking admin. */
@Injectable()
export class TrackingAdminQueryService implements TrackingAdminCommandPort {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly l1ResetGate: TrackingL1ResetGate,
  ) {}

  async getStatus(): Promise<TrackingStatusResponse> {
    const [state] = await this.ds.query<PipelineRow[]>(
      `SELECT enabled, watermark, config, active_run_id, total_candidates
       FROM state_track_pipeline WHERE id = 'default'`,
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
      `SELECT * FROM job_track_rebuild ORDER BY started_at DESC LIMIT 1`,
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
      metrics = this.buildLiteMetrics(
        activeRun,
        config,
        Number(pipeline.total_candidates ?? 0),
      );
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
      stepManifest: DEFAULT_TRACKING_STEP_MANIFEST,
    });
  }

  /** Необработанные pipeline-точки (SSOT: worker countTrackingPipelineRemaining). */
  private async countUnconsumedPipelineAt(until: Date): Promise<number> {
    return withPgContendedReadRetry(async () => {
      const targetIn = trackingTargetEventTypesSqlIn();

      const [{ count }] = await this.ds.query<{ count: string }[]>(
        `
      SELECT COUNT(*)::text AS count
      FROM mat_parse_location el
      JOIN mat_parse_event pe ON pe.id = el.parsed_event_id
      LEFT JOIN mat_ingest_raw rm ON rm.id = pe.raw_message_id
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
      `SELECT * FROM job_track_rebuild ORDER BY started_at DESC LIMIT $1`,
      [limit],
    );
    return rows.map(mapRunRow);
  }

  async readConfig(): Promise<TrackingPipelineConfig> {
    const [state] = await this.ds.query<PipelineRow[]>(
      `SELECT config FROM state_track_pipeline WHERE id = 'default'`,
    );
    return mergeConfig(state?.config);
  }

  async saveConfig(next: TrackingPipelineConfig): Promise<void> {
    await this.ds.query(
      `UPDATE state_track_pipeline SET config = $1::jsonb, updated_at = now() WHERE id = 'default'`,
      [JSON.stringify(next)],
    );
  }

  async setPipelineEnabled(enabled: boolean): Promise<void> {
    await this.ds.query(
      `UPDATE state_track_pipeline SET enabled = $1, updated_at = now() WHERE id = 'default'`,
      [enabled],
    );
  }

  async countUnconsumedPipeline(): Promise<number> {
    return this.countUnconsumedPipelineAt(new Date());
  }

  async isPipelineEnabled(): Promise<boolean> {
    const [state] = await this.ds.query<{ enabled: boolean }[]>(
      `SELECT enabled FROM state_track_pipeline WHERE id = 'default'`,
    );
    return state?.enabled === true;
  }

  async resetPipeline(): Promise<void> {
    await this.resetInternal();
  }

  async activateRun(runId: string): Promise<void> {
    await this.ds.query(
      `UPDATE state_track_pipeline SET active_run_id = $1, enabled = true, updated_at = now() WHERE id = 'default'`,
      [runId],
    );
  }

  async setRunPaused(runId: string, paused: boolean): Promise<void> {
    await this.setRunControl(runId, { pause: paused });
    await this.ds.query(
      `UPDATE job_track_rebuild SET status = $1 WHERE id = $2`,
      [paused ? "paused" : "running", runId],
    );
  }

  async getRunStatus(runId: string): Promise<string | null> {
    const run = await this.loadRun(runId);
    return run?.status ?? null;
  }

  async cancelRun(runId: string): Promise<void> {
    await this.setRunControl(runId, { cancel: true });
    await this.ds.query(
      `UPDATE job_track_rebuild SET status = 'cancelled', finished_at = now() WHERE id = $1`,
      [runId],
    );
    await this.ds.query(
      `UPDATE state_track_pipeline SET active_run_id = NULL, updated_at = now() WHERE id = 'default'`,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────

  private async resetInternal(): Promise<void> {
    await this.runL1Reset(async () => {
      await this.cancelActiveRuns();
      await this.ds.query(
        `UPDATE state_track_pipeline
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
        WHERE c.relname IN ('mat_track', 'mat_track_node', 'state_track_consumed')
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
        WHERE c.relname IN ('mat_track', 'mat_track_node', 'state_track_consumed')
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
          AND c.relname IN ('mat_track', 'mat_track_node', 'state_track_consumed')
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
              c.relname IN ('mat_track', 'mat_track_node', 'state_track_consumed')
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
              `UPDATE state_track_pipeline
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
      `UPDATE job_track_rebuild
       SET status = 'cancelled', finished_at = now(),
           control = COALESCE(control, '{}'::jsonb) || '{"cancel":true}'::jsonb
       WHERE status IN ('running', 'paused')`,
    );
  }

  async createRun(
    mode: "incremental" | TrackingRebuildMode,
  ): Promise<string> {
    const id = randomUUID();
    const rebuildGen = randomUUID();
    const since = new Date(0).toISOString();
    const until = new Date().toISOString();
    await this.ds.query(
      `INSERT INTO job_track_rebuild
       (id, status, mode, since, until, rebuild_gen, stats)
       VALUES ($1, 'running', $2, $3, $4, $5, $6::jsonb)`,
      [id, mode, since, until, rebuildGen, JSON.stringify({ stage: "loading", elapsedMs: 0 })],
    );
    return id;
  }

  /** running/paused run: active_run_id или последний controllable run в БД. */
  async findControllableRunId(): Promise<string | null> {
    const [state] = await this.ds.query<{ active_run_id: string | null }[]>(
      `SELECT active_run_id FROM state_track_pipeline WHERE id = 'default'`,
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
      `SELECT * FROM job_track_rebuild
       WHERE status IN ('running', 'paused')
       ORDER BY started_at DESC
       LIMIT 1`,
    );
    return row ? mapRunRow(row) : null;
  }

  private async loadRun(id: string): Promise<TrackingRebuildRun | null> {
    const [row] = await this.ds.query<RunRow[]>(
      `SELECT * FROM job_track_rebuild WHERE id = $1`,
      [id],
    );
    return row ? mapRunRow(row) : null;
  }

  private async readRunControl(runId: string) {
    const [row] = await this.ds.query<{ control: RunRow["control"] }[]>(
      `SELECT control FROM job_track_rebuild WHERE id = $1`,
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
      `UPDATE job_track_rebuild SET control = $1::jsonb WHERE id = $2`,
      [JSON.stringify({ ...current, ...patch }), runId],
    );
  }

  /** Безопасный COUNT треков — retry при конкуренции с worker persist. */
  private async countTracksSafe(): Promise<number> {
    return withTrackingL1ReadRetry(async () => {
      const [{ count }] = await this.ds.query<{ count: string }[]>(
        `SELECT COUNT(*)::text AS count FROM mat_track`,
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
    pipelineTotalCandidates: number,
  ): TrackingPipelineMetrics {
    const stats = activeRun?.stats ?? {};
    const processedCandidates = stats.processedCandidates ?? 0;
    const pendingCandidates = stats.pendingCandidates ?? 0;
    const totalTargetCandidates = Math.max(
      stats.totalCandidates ?? 0,
      pipelineTotalCandidates,
      processedCandidates + pendingCandidates,
    );
    const unconsumedPipeline = Math.max(
      0,
      stats.pendingCandidates ?? (totalTargetCandidates - processedCandidates),
    );
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
    const effectiveBatchSize = stats.batchSize ?? resolveDaemonBatchSize(config.batchSize);
    const tracksActive = stats.kalmanTracksOpen ?? 0;
    const tracksClosed = stats.kalmanTracksClosed ?? 0;

    return {
      totalCandidatesGeo: totalTargetCandidates,
      totalTargetCandidates,
      unconsumedPipeline,
      candidateWindowSize: stats.candidateWindowSize,
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
      FROM mat_parse_location el
      JOIN mat_parse_event pe ON pe.id = el.parsed_event_id
      LEFT JOIN mat_ingest_raw rm ON rm.id = pe.raw_message_id
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
      FROM mat_parse_location el
      JOIN mat_parse_event pe ON pe.id = el.parsed_event_id
      LEFT JOIN mat_ingest_raw rm ON rm.id = pe.raw_message_id
      WHERE ${EVENT_AT_SQL} <= $1
        AND el.lat IS NOT NULL AND el.lon IS NOT NULL
        AND pe.is_active IS DISTINCT FROM false
        AND pe.event_type IN (${targetIn})
      `,
      [until.toISOString()],
    );

    const [{ nodes }] = await this.ds.query<{ nodes: string }[]>(
      `SELECT COUNT(*)::text AS nodes FROM mat_track_node`,
    );

    const trackRows = await this.ds.query<{ status: string; count: string }[]>(
      `SELECT status, COUNT(*)::text AS count FROM mat_track GROUP BY status`,
    );
    const byStatus = Object.fromEntries(trackRows.map(r => [r.status, Number(r.count)]));
    const tracksActive = byStatus.active ?? 0;
    const tracksClosed = byStatus.closed ?? 0;
    const tracksStale = byStatus.stale ?? 0;

    const totalTargetCandidates = Number(targetCount);
    const nodesInTracks = Number(nodes);
    const unconsumedPipeline = await this.countUnconsumedPipelineAt(until);
    const candidateWindowSize = await this.countCandidateWindowSize(until, config, unconsumedPipeline);
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
      candidateWindowSize,
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
   * Live-размер candidate window: pending ∪ consumed-якоря в окне ε_temporal.
   * Pending и anchors не пересекаются → сумма.
   */
  private async countCandidateWindowSize(
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
      FROM mat_parse_location el
      JOIN mat_parse_event pe ON pe.id = el.parsed_event_id
      LEFT JOIN mat_ingest_raw rm ON rm.id = pe.raw_message_id
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
      FROM mat_parse_location el
      JOIN mat_parse_event pe ON pe.id = el.parsed_event_id
      LEFT JOIN mat_ingest_raw rm ON rm.id = pe.raw_message_id
      WHERE
        ${EVENT_AT_SQL} <= $1
        AND ${EVENT_AT_SQL} >= $2
        AND el.lat IS NOT NULL
        AND el.lon IS NOT NULL
        AND pe.is_active IS DISTINCT FROM false
        AND pe.event_type IN (${targetIn})
        AND EXISTS (
          SELECT 1 FROM state_track_consumed tpc
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
