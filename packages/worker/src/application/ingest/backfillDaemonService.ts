import type {
  BackfillJobRecord,
  BackfillStrategy,
  IChannelRepository,
  IIngestBackfillJobRepository,
  IIngestBindingRepository,
  IIngestCursorRepository,
  IIngestProviderRepository,
  IngestNormalizedMessage,
  StreamHistoryParams,
  TelegramMtprotoAppCredentials,
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
): StreamHistoryParams {
  const strategy = normalizeStrategy(job.strategy);
  const p = job.params as Record<string, unknown>;
  const stream: StreamHistoryParams = {};

  if (checkpoint?.offsetId) {
    const offsetId = Number(checkpoint.offsetId);
    if (Number.isFinite(offsetId)) stream.offsetId = offsetId;
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
 * Демон backfill: поллит ingest_backfill_jobs, стримит историю, чекпоинт после каждого сообщения.
 */
export class BackfillDaemonService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(
    private readonly jobs: IIngestBackfillJobRepository,
    private readonly providers: IIngestProviderRepository,
    private readonly bindings: IIngestBindingRepository,
    private readonly channels: IChannelRepository,
    private readonly cursors: IIngestCursorRepository,
    private readonly ingestHandler: IngestRawMessageHandler,
    private readonly sessionResolver: SessionResolver,
    private readonly telegramMtprotoApp: TelegramMtprotoAppCredentials,
    private readonly pollMs = Number(process.env.RADAR_BACKFILL_POLL_MS ?? "15000"),
  ) {}

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.pollMs);
    console.log(`BackfillDaemon: poll каждые ${this.pollMs}ms`);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const job = await this.jobs.findRunnable();
      if (!job) return;
      await this.runJob(job);
    } catch (err) {
      console.error("BackfillDaemon tick error:", err);
    } finally {
      this.ticking = false;
    }
  }

  private async runJob(job: BackfillJobRecord): Promise<void> {
    if (job.status === "pending") {
      await this.jobs.updateStatus(job.id, "running", job.stats);
    }

    let currentJob = (await this.jobs.findById(job.id)) ?? job;
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

    const adapter = createRawIngestAdapter(provider.adapterKind, this.sessionResolver);
    if ("setChannelKeyMap" in adapter && typeof adapter.setChannelKeyMap === "function") {
      adapter.setChannelKeyMap(new Map([[binding.id, channel.key]]));
    }

    if (!adapter.streamHistory) {
      await this.jobs.updateStatus(job.id, "failed", currentJob.stats);
      throw new Error(`Adapter ${provider.adapterKind} не поддерживает streamHistory`);
    }

    const checkpoint = readCheckpoint(currentJob.params);
    const streamParams = buildStreamParams(currentJob, checkpoint);

    try {
      await adapter.connect(
        buildIngestAdapterConnectContext({
          provider,
          sessionResolver: this.sessionResolver,
          telegramMtprotoApp: this.telegramMtprotoApp,
        }),
      );

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

        await this.jobs.updateProgress(currentJob.id, { stats, params });
        await this.cursors.updateBackfillState(channel.key, provider.key, {
          jobId: currentJob.id,
          lastExternalMessageId: normalized.externalMessageId,
          lastPostedAt: normalized.postedAt,
        });

        currentJob = {
          ...currentJob,
          stats,
          params,
        };
      };

      await adapter.streamHistory(binding, streamParams, sink);
      await this.jobs.updateStatus(currentJob.id, "completed", currentJob.stats);
      console.log(`BackfillDaemon: job ${currentJob.id} completed`, currentJob.stats);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`BackfillDaemon: job ${currentJob.id} failed:`, message);
      await this.jobs.updateStatus(currentJob.id, "failed", currentJob.stats);
    } finally {
      await adapter.stop();
    }
  }
}

/** Включён ли демон (по умолчанию в db mode — да). */
export function isBackfillDaemonEnabled(): boolean {
  const flag = process.env.RADAR_BACKFILL_DAEMON_ENABLED?.trim();
  if (flag === "0" || flag === "false") return false;
  return true;
}
