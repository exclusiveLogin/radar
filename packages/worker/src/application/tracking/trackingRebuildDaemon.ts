/**
 * Фоновый daemon инкрементального rebuild треков (watermark + batch UPSERT).
 */
import type { DataSource } from "typeorm";
import {
  trackingPipelineConfigSchema,
  resolveNextGenDaemonBatchSize,
  H3VectorFlowMap,
  type TrackingPipelineConfig,
  type TrackingRebuildStats,
  type TrackingWatermark,
} from "@radar/shared";
import { randomUUID } from "crypto";
import {
  countTrackingPipelineRemaining,
  loadDedupClosure,
  runIncrementalBatch,
} from "./trackingRebuildService.js";
import { maxEpsilonTemporalMs } from "@radar/shared";

type PipelineState = {
  enabled: boolean;
  watermark: TrackingWatermark | Record<string, never>;
  config: TrackingPipelineConfig;
  active_run_id: string | null;
  total_candidates: string | null;
};

type RunControl = { pause?: boolean; cancel?: boolean };

const DEFAULT_INTERVAL_MS = 10_000;

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
  /** Run-scoped H3-поля NextGen по run.id: батчи прогона обогащают, finish/fail обнуляет. */
  private readonly flowFieldByRun = new Map<string, H3VectorFlowMap>();

  constructor(private readonly ds: DataSource) {}

  /** Поле потока прогона (создаётся лениво только для nextgen-gravity). */
  private acquireFlowField(runId: string, config: TrackingPipelineConfig): H3VectorFlowMap {
    const existing = this.flowFieldByRun.get(runId);
    if (existing) return existing;
    const field = new H3VectorFlowMap(config.nextgen?.h3Resolution ?? 8);
    this.flowFieldByRun.set(runId, field);
    return field;
  }

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

  /** Один тик (CLI / тесты). */
  async runOnce(): Promise<void> {
    await this.runCycle();
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
    if (!state.enabled) {
      return;
    }

    const config = mergeConfig(state.config);
    const until = new Date();
    const lookbackMs = maxEpsilonTemporalMs(config.profiles);

    // Heartbeat до тяжёлого loadDedupClosure — админка видит стадию loading.
    if (state.active_run_id) {
      await this.touchRunHeartbeat(state.active_run_id, { stage: "loading" });
    }

    let closureLoad;
    try {
      closureLoad = await loadDedupClosure(this.ds, { until, lookbackMs });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[tracking-daemon] dedup closure load failed:", message);
      const staleRun = await this.ensureActiveRun(state, true);
      if (staleRun) {
        await this.failRun(staleRun.id, message, Date.now() - new Date(staleRun.startedAt).getTime());
      }
      return;
    }

    const { pending: allPending, closure } = closureLoad;

    const run = await this.ensureActiveRun(state, allPending.length > 0);
    if (!run) return;

    const runStartedMs = new Date(run.startedAt).getTime();

    const control = await this.readRunControl(run.id);
    if (control?.pause || control?.cancel) return;

    if (allPending.length === 0) {
      await this.finishRun(run.id);
      return;
    }

    await this.updateRunStats(run.id, {
      stage: "loading",
      pendingCandidates: allPending.length,
      dedupClosureSize: closure.length,
      elapsedMs: Date.now() - runStartedMs,
    });

    const batchSize = resolveNextGenDaemonBatchSize(config.batchSize);
    const chunk = allPending.slice(0, batchSize);

    const totalCandidates =
      Number((await this.readRunStats(run.id))?.totalCandidates)
      || (await countTrackingPipelineRemaining(this.ds, { until }));
    let processed = Number((await this.readRunStats(run.id))?.processedCandidates ?? 0);
    const fullPendingIds = new Set(allPending.map(c => c.eventLocationId));

    let collapsedTotal = 0;
    let lastScannerStats: Partial<TrackingRebuildStats> = {};
    const flowField = this.acquireFlowField(run.id, config);
    const result = await runIncrementalBatch(this.ds, {
      candidates: chunk,
      dedupClosure: closure,
      fullPendingIds,
      rebuildGen: run.rebuildGen,
      config,
      flowField,
      onProgress: async stats => {
        lastScannerStats = stats;
        const nextStats: Partial<TrackingRebuildStats> = {
          ...stats,
          batchSize,
          pendingCandidates: allPending.length,
          dedupClosureSize: closure.length,
          processedCandidates: processed,
          totalCandidates,
          percentApprox:
            totalCandidates > 0 ? Math.min(100, Math.round((processed / totalCandidates) * 100)) : 0,
          elapsedMs: Date.now() - runStartedMs,
        };
        await this.updateRunStats(run.id, nextStats);
      },
    });
    collapsedTotal = result.collapsedByDedup;
    processed += result.consumedCount;

    const remainingAfterBatch = await countTrackingPipelineRemaining(this.ds, { until });
    await this.updateRunStats(run.id, {
      ...lastScannerStats,
      stage: "idle",
      pendingCandidates: remainingAfterBatch,
      processedCandidates: processed,
      totalCandidates,
      percentApprox:
        totalCandidates > 0 ? Math.min(100, Math.round((processed / totalCandidates) * 100)) : 0,
      stdbscanCollapsed: collapsedTotal,
      elapsedMs: Date.now() - runStartedMs,
    });

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
    hasPending: boolean,
  ): Promise<{ id: string; rebuildGen: string; startedAt: string } | null> {
    if (state.active_run_id) {
      const [run] = await this.ds.query<{ id: string; rebuild_gen: string; status: string; started_at: string | Date }[]>(
        `SELECT id, rebuild_gen, status, started_at FROM trajectory_rebuild_runs WHERE id = $1`,
        [state.active_run_id],
      );
      if (run?.status === "running") {
        return {
          id: run.id,
          rebuildGen: run.rebuild_gen,
          startedAt:
            run.started_at instanceof Date
              ? run.started_at.toISOString()
              : String(run.started_at),
        };
      }
      // stale binding: run завершён, но active_run_id не сброшен — worker молчал
      if (run) {
        await this.ds.query(
          `UPDATE tracking_pipeline_state SET active_run_id = NULL, updated_at = now() WHERE id = 'default'`,
        );
      }
    }

    if (!hasPending) return null;

    const id = randomUUID();
    const rebuildGen = randomUUID();
    const since = isWatermark(state.watermark)
      ? state.watermark.lastOccurredAt
      : new Date(0).toISOString();
    const startedAt = new Date().toISOString();
    await this.ds.query(
      `INSERT INTO trajectory_rebuild_runs
       (id, status, mode, since, until, rebuild_gen, stats, started_at)
       VALUES ($1, 'running', 'incremental', $2, now(), $3, $4::jsonb, $5)`,
      [id, since, rebuildGen, JSON.stringify({ stage: "loading", elapsedMs: 0 }), startedAt],
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

  /** Обновляет elapsed/stage без полного батча — для poll админки. */
  private async touchRunHeartbeat(
    runId: string,
    patch: Partial<TrackingRebuildStats>,
  ): Promise<void> {
    const [row] = await this.ds.query<{ status: string; started_at: string | Date }[]>(
      `SELECT status, started_at FROM trajectory_rebuild_runs WHERE id = $1`,
      [runId],
    );
    if (row?.status !== "running") return;
    const startedMs = new Date(
      row.started_at instanceof Date ? row.started_at.toISOString() : row.started_at,
    ).getTime();
    await this.updateRunStats(runId, {
      ...patch,
      elapsedMs: Date.now() - startedMs,
    });
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
    this.flowFieldByRun.delete(runId);
    const stats = (await this.readRunStats(runId)) ?? {};
    const remaining = await countTrackingPipelineRemaining(this.ds, { until: new Date() });
    await this.ds.query(
      `UPDATE trajectory_rebuild_runs
       SET status = 'done', finished_at = now(), stats = stats || $1::jsonb
       WHERE id = $2`,
      [
        JSON.stringify({
          ...stats,
          stage: "done",
          pendingCandidates: remaining,
        }),
        runId,
      ],
    );
    await this.ds.query(
      `UPDATE tracking_pipeline_state SET active_run_id = NULL, updated_at = now() WHERE id = 'default'`,
    );
  }

  private async failRun(runId: string, error: string, elapsedMs: number): Promise<void> {
    this.flowFieldByRun.delete(runId);
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
  return trackingPipelineConfigSchema.parse(raw ?? {});
}

export function isTrackingDaemonEnabled(): boolean {
  return isEnabled();
}
