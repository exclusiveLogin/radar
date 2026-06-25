/**
 * Фоновый daemon инкрементального rebuild треков (watermark + batch UPSERT).
 */
import type { DataSource } from "typeorm";
import {
  trackingPipelineConfigSchema,
  type TrackingPipelineConfig,
  type TrackingRebuildStats,
  type TrackingWatermark,
} from "@radar/shared";
import { randomUUID } from "crypto";
import {
  countTrackingCandidates,
  loadTrackingCandidatesBatch,
  maxEpsilonTemporalMs,
  runIncrementalBatch,
} from "./trackingRebuildService.js";

type PipelineState = {
  enabled: boolean;
  watermark: TrackingWatermark | Record<string, never>;
  config: TrackingPipelineConfig;
  active_run_id: string | null;
  total_candidates: string | null;
};

type RunControl = { pause?: boolean; cancel?: boolean };

const DEFAULT_INTERVAL_MS = 10_000;
const DEFAULT_BATCH_SIZE = 1000;

function readIntervalMs(): number {
  const raw = Number(process.env.TRACKING_DAEMON_INTERVAL_MS);
  return Number.isFinite(raw) && raw >= 5000 ? raw : DEFAULT_INTERVAL_MS;
}

function isEnabled(): boolean {
  return process.env.TRACKING_DAEMON_ENABLED !== "false";
}

export class TrackingRebuildDaemon {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(private readonly ds: DataSource) {}

  start(): void {
    if (!isEnabled()) return;
    const intervalMs = readIntervalMs();
    this.timer = setInterval(() => void this.runCycle(), intervalMs);
    void this.runCycle();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async runCycle(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.processTick();
    } catch (err) {
      console.error("[tracking-daemon] tick failed:", err);
    } finally {
      this.ticking = false;
    }
  }

  private async processTick(): Promise<void> {
    const state = await this.loadPipelineState();
    if (!state.enabled) return;

    const run = await this.ensureActiveRun(state);
    if (!run) return;

    const control = await this.readRunControl(run.id);
    if (control?.pause || control?.cancel) return;

    const config = mergeConfig(state.config);
    const batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
    const overlapMs = maxEpsilonTemporalMs(config.profiles);
    const watermark = isWatermark(state.watermark) ? state.watermark : null;
    const until = new Date();
    const runStartedMs = new Date(run.startedAt).getTime();

    let batch;
    try {
      batch = await loadTrackingCandidatesBatch(this.ds, {
        after: watermark,
        until,
        limit: batchSize,
        overlapMs,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[tracking-daemon] batch load failed:", message);
      await this.failRun(run.id, message, Date.now() - runStartedMs);
      return;
    }

    if (batch.length === 0) {
      await this.finishRun(run.id);
      return;
    }

    const totalCandidates =
      Number(state.total_candidates) || (await countTrackingCandidates(this.ds, until));
    let processed = Number((await this.readRunStats(run.id))?.processedCandidates ?? 0);

    let collapsedTotal = 0;
    const result = await runIncrementalBatch(this.ds, {
      candidates: batch,
      rebuildGen: run.rebuildGen,
      config,
      onProgress: async stats => {
        processed += batch.length;
        const nextStats: Partial<TrackingRebuildStats> = {
          ...stats,
          batchSize,
          processedCandidates: processed,
          totalCandidates,
          percentApprox:
            totalCandidates > 0 ? Math.min(100, Math.round((processed / totalCandidates) * 100)) : 0,
          stdbscanCollapsed: collapsedTotal,
          elapsedMs: Date.now() - runStartedMs,
        };
        await this.updateRunStats(run.id, nextStats);
      },
    });
    collapsedTotal = result.collapsedByDedup;

    if (result.watermark) {
      await this.advanceWatermark(result.watermark, run.id, totalCandidates);
    }
  }

  private async loadPipelineState(): Promise<PipelineState> {
    const [row] = await this.ds.query<PipelineState[]>(
      `SELECT enabled, watermark, config, active_run_id, total_candidates
       FROM tracking_pipeline_state WHERE id = 'default'`,
    );
    return (
      row ?? {
        enabled: false,
        watermark: {},
        config: trackingPipelineConfigSchema.parse({}),
        active_run_id: null,
        total_candidates: null,
      }
    );
  }

  private async ensureActiveRun(
    state: PipelineState,
  ): Promise<{ id: string; rebuildGen: string; startedAt: string } | null> {
    if (state.active_run_id) {
      const [run] = await this.ds.query<{ id: string; rebuild_gen: string; status: string; started_at: string }[]>(
        `SELECT id, rebuild_gen, status, started_at FROM trajectory_rebuild_runs WHERE id = $1`,
        [state.active_run_id],
      );
      if (run && run.status === "running") {
        return { id: run.id, rebuildGen: run.rebuild_gen, startedAt: run.started_at };
      }
    }

    const id = randomUUID();
    const rebuildGen = randomUUID();
    const since = isWatermark(state.watermark)
      ? state.watermark.lastOccurredAt
      : new Date(0).toISOString();
    const startedAt = new Date().toISOString();
    await this.ds.query(
      `INSERT INTO trajectory_rebuild_runs
       (id, status, mode, since, until, rebuild_gen, stats, started_at)
       VALUES ($1, 'running', 'incremental', $2, now(), $3, '{}'::jsonb, $4)`,
      [id, since, rebuildGen, startedAt],
    );
    await this.ds.query(
      `UPDATE tracking_pipeline_state SET active_run_id = $1, updated_at = now() WHERE id = 'default'`,
      [id],
    );
    return { id, rebuildGen, startedAt };
  }

  private async readRunControl(runId: string): Promise<RunControl | null> {
    const [row] = await this.ds.query<{ control: RunControl | null }[]>(
      `SELECT control FROM trajectory_rebuild_runs WHERE id = $1`,
      [runId],
    );
    return row?.control ?? null;
  }

  private async readRunStats(runId: string): Promise<Partial<TrackingRebuildStats> | null> {
    const [row] = await this.ds.query<{ stats: Partial<TrackingRebuildStats> }[]>(
      `SELECT stats FROM trajectory_rebuild_runs WHERE id = $1`,
      [runId],
    );
    return row?.stats ?? null;
  }

  private async updateRunStats(runId: string, stats: Partial<TrackingRebuildStats>): Promise<void> {
    await this.ds.query(
      `UPDATE trajectory_rebuild_runs SET stats = stats || $1::jsonb WHERE id = $2`,
      [JSON.stringify(stats), runId],
    );
  }

  private async advanceWatermark(
    watermark: TrackingWatermark,
    runId: string,
    totalCandidates: number,
  ): Promise<void> {
    await this.ds.query(
      `UPDATE tracking_pipeline_state
       SET watermark = $1::jsonb, total_candidates = $2, updated_at = now()
       WHERE id = 'default'`,
      [JSON.stringify(watermark), totalCandidates],
    );
    await this.ds.query(
      `UPDATE trajectory_rebuild_runs SET checkpoint = $1::jsonb WHERE id = $2`,
      [JSON.stringify(watermark), runId],
    );
  }

  private async finishRun(runId: string): Promise<void> {
    const stats = (await this.readRunStats(runId)) ?? {};
    await this.ds.query(
      `UPDATE trajectory_rebuild_runs
       SET status = 'done', finished_at = now(), stats = stats || $1::jsonb
       WHERE id = $2`,
      [JSON.stringify({ ...stats, stage: "done" }), runId],
    );
    await this.ds.query(
      `UPDATE tracking_pipeline_state SET active_run_id = NULL, updated_at = now() WHERE id = 'default'`,
    );
  }

  private async failRun(runId: string, error: string, elapsedMs: number): Promise<void> {
    await this.ds.query(
      `UPDATE trajectory_rebuild_runs
       SET status = 'failed', finished_at = now(), error = $1,
           stats = stats || $2::jsonb
       WHERE id = $3`,
      [error, JSON.stringify({ stage: "loading", elapsedMs }), runId],
    );
    await this.ds.query(
      `UPDATE tracking_pipeline_state SET active_run_id = NULL, updated_at = now() WHERE id = 'default'`,
    );
  }
}

function isWatermark(value: unknown): value is TrackingWatermark {
  if (!value || typeof value !== "object") return false;
  const w = value as Record<string, unknown>;
  return typeof w.lastOccurredAt === "string" && typeof w.lastEventLocationId === "string";
}

function mergeConfig(raw: unknown): TrackingPipelineConfig {
  return trackingPipelineConfigSchema.parse({ batchSize: DEFAULT_BATCH_SIZE, ...(raw as object) });
}

export function isTrackingDaemonEnabled(): boolean {
  return isEnabled();
}
