import type {
  BackfillJobRecord,
  BackfillStrategy,
  IChannelRepository,
  IIngestBackfillJobRepository,
  IIngestBindingRepository,
  IIngestCursorRepository,
  IIngestProviderRepository,
  IngestNormalizedMessage,
  IngestProviderRecord,
  IRawIngestAdapter,
  StreamHistoryParams,
  TelegramMtprotoAppCredentials,
} from "@radar/shared";
import {
  readBackfillPreflight,
  readBackfillRoundRobinSlice,
  withBackfillRoundRobinSlice,
} from "@radar/shared";
import { createRawIngestAdapter } from "../../infrastructure/ingest-adapters/adapterRegistry.js";
import type { IngestRawMessageHandler } from "../handlers/ingestRawMessageHandler.js";
import type { SessionResolver } from "../sessions/sessionResolver.js";
import { buildIngestAdapterConnectContext } from "./buildIngestAdapterConnectContext.js";
import { ingestNormalizedToRaw } from "./ingestMessageMapper.js";

type BackfillCheckpoint = {
  offsetId: string;
  postedAt: string;
};

/** Сигнал «оператор отменил job»: прерывает стрим без перевода в failed. */
class BackfillCanceledError extends Error {
  constructor(jobId: string) {
    super(`Backfill job canceled: ${jobId}`);
    this.name = "BackfillCanceledError";
  }
}

/** Каждые N сообщений перечитываем статус job, чтобы заметить отмену. */
const CANCEL_CHECK_EVERY = 10;

/** Размер батча Telegram за один тик демона (round-robin между каналами). */
function readBatchLimit(params: Record<string, unknown>): number {
  const batch = params.batchSize;
  if (typeof batch === "number" && Number.isFinite(batch) && batch > 0) {
    return Math.min(Math.floor(batch), 500);
  }
  return 50;
}

/** Как часто сбрасывать stats/checkpoint в БД внутри батча. */
function readProgressFlushEvery(params: Record<string, unknown>): number {
  return Math.min(readBatchLimit(params), 50);
}

function normalizeStrategy(strategy: string): BackfillStrategy {
  if (strategy === "all") return "full_history";
  return strategy as BackfillStrategy;
}

function readCheckpoint(params: Record<string, unknown>): BackfillCheckpoint | null {
  const raw = params.checkpoint;
  if (!raw || typeof raw !== "object") return null;
  const cp = raw as { offsetId?: unknown; postedAt?: unknown };
  if (typeof cp.offsetId !== "string" || typeof cp.postedAt !== "string") return null;
  return { offsetId: cp.offsetId, postedAt: cp.postedAt };
}

function buildStreamParams(
  job: BackfillJobRecord,
  checkpoint: BackfillCheckpoint | null,
  batchLimit: number,
): StreamHistoryParams {
  const strategy = normalizeStrategy(job.strategy);
  const p = job.params as Record<string, unknown>;
  // По умолчанию: с последнего сообщения канала к старым (закрывает «дыру» спереди).
  const stream: StreamHistoryParams = { reverse: false, limit: batchLimit };

  if (checkpoint?.offsetId) {
    const offsetId = Number(checkpoint.offsetId);
    if (Number.isFinite(offsetId)) stream.offsetId = offsetId;
  }

  if (p.streamReverse === true) {
    stream.reverse = true;
  }

  if (strategy === "by_date_range") {
    if (typeof p.fromPostedAt === "string") stream.fromPostedAt = p.fromPostedAt;
    if (typeof p.toPostedAt === "string") stream.toPostedAt = p.toPostedAt;
  }

  if (strategy === "by_external_id_range") {
    if (typeof p.fromExternalId === "string") stream.fromExternalId = p.fromExternalId;
    if (typeof p.toExternalId === "string") stream.toExternalId = p.toExternalId;
  }

  return stream;
}

/**
 * Демон backfill: round-robin по активным job, один батч Telegram за тик на канал.
 */
export class BackfillDaemonService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private pulseTimer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private roundRobinIndex = 0;
  /** MTProto-клиент на провайдера: один connect на весь жизненный цикл демона. */
  private readonly adaptersByProvider = new Map<string, IRawIngestAdapter>();

  constructor(
    private readonly jobs: IIngestBackfillJobRepository,
    private readonly providers: IIngestProviderRepository,
    private readonly bindings: IIngestBindingRepository,
    private readonly channels: IChannelRepository,
    private readonly cursors: IIngestCursorRepository,
    private readonly ingestHandler: IngestRawMessageHandler,
    private readonly sessionResolver: SessionResolver,
    private readonly telegramMtprotoApp: TelegramMtprotoAppCredentials,
    private readonly pollMs: number,
    private readonly heartbeatMs: number,
  ) {}

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.pollMs);
    if (this.heartbeatMs > 0) {
      this.pulseTimer = setInterval(() => {
        void this.pulseRunnableJobs().catch((err) => {
          console.warn("BackfillDaemon heartbeat error:", err);
        });
      }, this.heartbeatMs);
    }
    console.log(
      `BackfillDaemon: poll ${this.pollMs}ms, heartbeat ${this.heartbeatMs}ms (round-robin batch)`,
    );
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.pulseTimer) {
      clearInterval(this.pulseTimer);
      this.pulseTimer = null;
    }
    for (const adapter of this.adaptersByProvider.values()) {
      await adapter.stop();
    }
    this.adaptersByProvider.clear();
  }

  /** Подключает telegram-адаптер один раз на providerId; повторные тики переиспользуют сессию. */
  private async ensureAdapter(provider: IngestProviderRecord): Promise<IRawIngestAdapter> {
    const cached = this.adaptersByProvider.get(provider.id);
    if (cached) return cached;

    const adapter = createRawIngestAdapter(provider.adapterKind, this.sessionResolver);
    await adapter.connect(
      buildIngestAdapterConnectContext({
        provider,
        sessionResolver: this.sessionResolver,
        telegramMtprotoApp: this.telegramMtprotoApp,
      }),
    );
    this.adaptersByProvider.set(provider.id, adapter);
    return adapter;
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const jobs = await this.jobs.findRunnableMany(32);
      if (!jobs.length) return;

      const job = jobs[this.roundRobinIndex % jobs.length]!;
      this.roundRobinIndex += 1;

      await this.publishRoundRobinSlice(jobs, job.id);
      await this.pulseRunnableJobs();
      await this.runJobBatch(job);
    } catch (err) {
      console.error("BackfillDaemon tick error:", err);
    } finally {
      this.ticking = false;
    }
  }

  /** Перечитывает статус job: true, если оператор запросил отмену. */
  private async isCanceled(jobId: string): Promise<boolean> {
    const fresh = await this.jobs.findById(jobId);
    return fresh?.status === "canceled";
  }

  /** Пульс updated_at для всех runnable job — админка видит живую очередь. */
  private async pulseRunnableJobs(): Promise<void> {
    const jobs = await this.jobs.findRunnableMany(32);
    await Promise.all(jobs.map((row) => this.jobs.touch(row.id)));
  }

  /** Одна runnable job — всегда active (жёлтый waiting только при конкуренции каналов). */
  private resolveRoundRobinSlice(
    runnableCount: number,
    jobId: string,
    activeJobId: string,
  ): "active" | "waiting" {
    if (runnableCount <= 1) return "active";
    return jobId === activeJobId ? "active" : "waiting";
  }

  /** Публикует active/waiting для runnable job — читает админка по WS/REST. */
  private async publishRoundRobinSlice(
    runnableJobs: BackfillJobRecord[],
    activeJobId: string,
  ): Promise<void> {
    await Promise.all(
      runnableJobs.map((row) => {
        const slice = this.resolveRoundRobinSlice(
          runnableJobs.length,
          row.id,
          activeJobId,
        );
        if (readBackfillRoundRobinSlice(row.params) === slice) return Promise.resolve();
        return this.jobs.updateProgress(row.id, {
          params: withBackfillRoundRobinSlice(row.params, slice),
        });
      }),
    );
  }

  /** Снимает метку round-robin при завершении job. */
  private async clearRoundRobinSlice(
    jobId: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    if (!readBackfillRoundRobinSlice(params)) return;
    await this.jobs.updateProgress(jobId, {
      params: withBackfillRoundRobinSlice(params, null),
    });
  }

  /** Один батч истории; при исчерпании канала — completed. */
  private async runJobBatch(job: BackfillJobRecord): Promise<void> {
    let currentJob = job;

    try {
      if (job.status === "pending") {
        await this.jobs.updateStatus(job.id, "running", job.stats);
      }

      currentJob = (await this.jobs.findById(job.id)) ?? job;
      if (currentJob.status === "canceled") return;

      const binding = await this.bindings.findById(currentJob.bindingId);
      if (!binding) {
        await this.jobs.updateStatus(job.id, "failed", currentJob.stats);
        throw new Error(`Binding not found: ${currentJob.bindingId}`);
      }

      const provider = await this.providers.findById(currentJob.providerId);
      if (!provider) {
        await this.jobs.updateStatus(job.id, "failed", currentJob.stats);
        throw new Error(`Provider not found: ${currentJob.providerId}`);
      }

      const channel = binding.channelId
        ? await this.channels.findById(binding.channelId)
        : null;
      if (!channel) {
        await this.jobs.updateStatus(job.id, "failed", currentJob.stats);
        throw new Error(`Channel not found for binding ${binding.id}`);
      }

      const adapter = await this.ensureAdapter(provider);
      if ("setChannelKeyMap" in adapter && typeof adapter.setChannelKeyMap === "function") {
        adapter.setChannelKeyMap(new Map([[binding.id, channel.key]]));
      }

      if (!adapter.streamHistory) {
        await this.jobs.updateStatus(job.id, "failed", currentJob.stats);
        throw new Error(`Adapter ${provider.adapterKind} не поддерживает streamHistory`);
      }

      const batchLimit = readBatchLimit(currentJob.params);
      const checkpoint = readCheckpoint(currentJob.params);
      const streamParams = buildStreamParams(currentJob, checkpoint, batchLimit);

      try {
        if (!readBackfillPreflight(currentJob.params)) {
          if (!adapter.probeChannelBounds) {
            await this.jobs.updateStatus(job.id, "failed", currentJob.stats);
            throw new Error(`Adapter ${provider.adapterKind} не поддерживает preflight probe`);
          }

          const bounds = await adapter.probeChannelBounds(binding.externalTarget);
          const paramsWithPreflight = {
            ...currentJob.params,
            preflight: bounds,
            streamReverse: false,
          };
          await this.jobs.updateProgress(currentJob.id, { params: paramsWithPreflight });
          currentJob = { ...currentJob, params: paramsWithPreflight };
        }

        let processedSinceCancelCheck = 0;
        let processedSinceProgressFlush = 0;
        let progressDirty = false;

        const flushProgress = async (): Promise<void> => {
          if (!progressDirty) return;
          await this.jobs.updateProgress(currentJob.id, {
            stats: currentJob.stats,
            params: currentJob.params,
          });
          progressDirty = false;
          processedSinceProgressFlush = 0;
        };

        const sink = async (normalized: IngestNormalizedMessage) => {
          const { raw, extension } = ingestNormalizedToRaw(normalized, "backfill");
          const ingestResult = await this.ingestHandler.handle(raw, extension);

          const stats = { ...currentJob.stats };
          if (ingestResult.inserted) stats.inserted += 1;
          else stats.duplicates += 1;

          const params = {
            ...currentJob.params,
            checkpoint: {
              offsetId: normalized.externalMessageId,
              postedAt: normalized.postedAt,
            },
          };

          currentJob = {
            ...currentJob,
            stats,
            params,
          };
          progressDirty = true;

          const flushEvery = readProgressFlushEvery(currentJob.params);
          if (++processedSinceProgressFlush >= flushEvery) {
            await flushProgress();
          }

          await this.cursors.updateBackfillState(channel.key, provider.key, {
            jobId: currentJob.id,
            lastExternalMessageId: normalized.externalMessageId,
            lastPostedAt: normalized.postedAt,
          });

          if (++processedSinceCancelCheck >= CANCEL_CHECK_EVERY) {
            processedSinceCancelCheck = 0;
            if (await this.isCanceled(currentJob.id)) {
              throw new BackfillCanceledError(currentJob.id);
            }
          }
        };

        const streamResult = await adapter.streamHistory(binding, streamParams, sink);
        await flushProgress();

        const historyExhausted = streamResult.streamed < batchLimit;
        if (historyExhausted) {
          await this.jobs.updateStatus(currentJob.id, "completed", currentJob.stats);
          await this.clearRoundRobinSlice(currentJob.id, currentJob.params);
          console.log(`BackfillDaemon: job ${currentJob.id} completed`, currentJob.stats);
        }
      } catch (err) {
        if (err instanceof BackfillCanceledError) {
          console.log(`BackfillDaemon: job ${currentJob.id} canceled (stats:`, currentJob.stats, ")");
          await this.jobs.updateProgress(currentJob.id, {
            stats: currentJob.stats,
            params: currentJob.params,
          });
          await this.clearRoundRobinSlice(currentJob.id, currentJob.params);
        } else {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`BackfillDaemon: job ${currentJob.id} failed:`, message);
          await this.jobs.updateProgress(currentJob.id, {
            stats: currentJob.stats,
            params: currentJob.params,
          });
          await this.jobs.updateStatus(currentJob.id, "failed", currentJob.stats);
          await this.clearRoundRobinSlice(currentJob.id, currentJob.params);
        }
      }
    } finally {
      const fresh = await this.jobs.findById(currentJob.id);
      if (fresh && (fresh.status === "pending" || fresh.status === "running")) {
        const runnable = await this.jobs.findRunnableMany(32);
        const slice = this.resolveRoundRobinSlice(runnable.length, fresh.id, fresh.id);
        await this.jobs.updateProgress(fresh.id, {
          params: withBackfillRoundRobinSlice(fresh.params, slice),
        });
      }
    }
  }
}

