import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import {
  trackingPipelineConfigSchema,
  trackingStatusResponseSchema,
  trackingTargetEventTypesSqlIn,
  type TrackingPipelineConfig,
  type TrackingPipelineMetrics,
  type TrackingRebuildRun,
  type TrackingStatusResponse,
  type TrackingWatermark,
} from "@radar/shared";
import type { DataSource } from "typeorm";
import { randomUUID } from "crypto";

type PipelineRow = {
  enabled: boolean;
  watermark: TrackingWatermark | Record<string, never>;
  config: TrackingPipelineConfig;
  active_run_id: string | null;
  total_candidates: string | null;
};

type RunRow = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  mode: string;
  since: string;
  until: string;
  rebuild_gen: string;
  stats: Record<string, unknown>;
  checkpoint: TrackingWatermark | null;
  control: { pause?: boolean; cancel?: boolean } | null;
  error: string | null;
};

const DEFAULT_CONFIG = trackingPipelineConfigSchema.parse({});
const EVENT_AT_SQL = "COALESCE(el.occurred_at, rm.posted_at, pe.parsed_at)";

/** Админка пайплайна треков: статус, runs, управление daemon. */
@Injectable()
export class TrackingAdminService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

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

    const activeRun = pipeline.active_run_id
      ? await this.loadRun(pipeline.active_run_id)
      : null;
    const [lastRunRow] = await this.ds.query<RunRow[]>(
      `SELECT * FROM trajectory_rebuild_runs ORDER BY started_at DESC LIMIT 1`,
    );
    const lastRun = lastRunRow ? mapRunRow(lastRunRow) : null;

    const [{ count: totalTracks }] = await this.ds.query<{ count: string }[]>(
      `SELECT COUNT(*)::text AS count FROM trajectory_tracks`,
    );
    const control = activeRun ? await this.readRunControl(activeRun.id) : null;
    const metrics = await this.collectMetrics(new Date(), activeRun);
    /** SSOT прогресса: целевые активные точки vs материализации в trajectory_nodes. */
    const totalCandidates = metrics.totalTargetCandidates;
    const percentApprox = metrics.percentNodesInTracks;

    return trackingStatusResponseSchema.parse({
      enabled: pipeline.enabled,
      paused: control?.pause === true,
      daemonRunning: activeRun?.status === "running",
      activeRun,
      lastRun,
      watermark: isWatermark(pipeline.watermark) ? pipeline.watermark : null,
      totalTracks: Number(totalTracks),
      totalCandidates,
      percentApprox,
      metrics,
      config: mergeConfig(pipeline.config),
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
    return { ok: true, enabled };
  }

  async rebuild(): Promise<{ ok: true; runId: string }> {
    await this.resetInternal();
    const runId = await this.createRun("full_rebuild");
    await this.ds.query(
      `UPDATE tracking_pipeline_state SET active_run_id = $1, enabled = true, updated_at = now() WHERE id = 'default'`,
      [runId],
    );
    return { ok: true, runId };
  }

  async reset(): Promise<{ ok: true }> {
    await this.resetInternal();
    return { ok: true };
  }

  async pause(): Promise<{ ok: true }> {
    const status = await this.getStatus();
    if (!status.activeRun) throw new BadRequestException("no active run");
    await this.setRunControl(status.activeRun.id, { pause: true });
    await this.ds.query(
      `UPDATE trajectory_rebuild_runs SET status = 'paused' WHERE id = $1`,
      [status.activeRun.id],
    );
    return { ok: true };
  }

  async resume(): Promise<{ ok: true }> {
    const status = await this.getStatus();
    if (!status.activeRun) throw new BadRequestException("no active run");
    await this.setRunControl(status.activeRun.id, { pause: false });
    await this.ds.query(
      `UPDATE trajectory_rebuild_runs SET status = 'running' WHERE id = $1`,
      [status.activeRun.id],
    );
    return { ok: true };
  }

  async cancel(): Promise<{ ok: true }> {
    const status = await this.getStatus();
    if (!status.activeRun) throw new BadRequestException("no active run");
    await this.setRunControl(status.activeRun.id, { cancel: true });
    await this.ds.query(
      `UPDATE trajectory_rebuild_runs SET status = 'cancelled', finished_at = now() WHERE id = $1`,
      [status.activeRun.id],
    );
    await this.ds.query(
      `UPDATE tracking_pipeline_state SET active_run_id = NULL, updated_at = now() WHERE id = 'default'`,
    );
    return { ok: true };
  }

  private async resetInternal(): Promise<void> {
    await this.cancelActiveRuns();
    await this.ds.query(`TRUNCATE trajectory_nodes, trajectory_tracks`);
    await this.ds.query(
      `UPDATE tracking_pipeline_state
       SET watermark = '{}'::jsonb, active_run_id = NULL, updated_at = now()
       WHERE id = 'default'`,
    );
  }

  private async cancelActiveRuns(): Promise<void> {
    await this.ds.query(
      `UPDATE trajectory_rebuild_runs
       SET status = 'cancelled', finished_at = now()
       WHERE status IN ('running', 'paused')`,
    );
  }

  private async createRun(mode: "incremental" | "full_rebuild"): Promise<string> {
    const id = randomUUID();
    const rebuildGen = randomUUID();
    const since = new Date(0).toISOString();
    const until = new Date().toISOString();
    await this.ds.query(
      `INSERT INTO trajectory_rebuild_runs
       (id, status, mode, since, until, rebuild_gen, stats)
       VALUES ($1, 'running', $2, $3, $4, $5, '{}'::jsonb)`,
      [id, mode, since, until, rebuildGen],
    );
    return id;
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

  /** Агрегированные метрики: целевые точки, % в треках, статусы треков, время run. */
  private async collectMetrics(
    until: Date,
    activeRun: TrackingRebuildRun | null,
  ): Promise<TrackingPipelineMetrics> {
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
    const percentNodesInTracks =
      totalTargetCandidates > 0
        ? Math.min(100, Math.round((nodesInTracks / totalTargetCandidates) * 100))
        : 0;

    const runStartedAt = activeRun?.startedAt ?? null;
    const elapsedMs =
      runStartedAt && activeRun?.status === "running"
        ? Math.max(0, Date.now() - new Date(runStartedAt).getTime())
        : activeRun?.stats?.elapsedMs;

    return {
      totalCandidatesGeo: Number(geoCount),
      totalTargetCandidates,
      processedCandidates: nodesInTracks,
      percentProcessed: percentNodesInTracks,
      nodesInTracks,
      percentNodesInTracks,
      tracksActive,
      tracksClosed,
      tracksStale,
      tracksTotal: tracksActive + tracksClosed + tracksStale,
      elapsedMs,
      runStartedAt,
    };
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

function mapRunRow(row: RunRow): TrackingRebuildRun {
  return {
    id: row.id,
    status: row.status as TrackingRebuildRun["status"],
    mode: row.mode as TrackingRebuildRun["mode"],
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    since: row.since,
    until: row.until,
    rebuildGen: row.rebuild_gen,
    stats: row.stats ?? {},
    checkpoint: row.checkpoint ?? null,
    error: row.error,
  };
}
