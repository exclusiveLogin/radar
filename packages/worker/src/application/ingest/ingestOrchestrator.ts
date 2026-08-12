import type {
  IChannelRepository,
  IEventPublisher,
  IIngestBindingRepository,
  IIngestProviderRepository,
  IngestNormalizedMessage,
  IngestProviderRecord,
  TelegramMtprotoAppCredentials,
} from "@radar/shared";
import { randomUUID } from "node:crypto";
import { buildDomainEvent } from "../handlers/domainEventFactory.js";
import type { IngestRawMessageHandler } from "../handlers/ingestRawMessageHandler.js";
import { createRawIngestAdapter } from "../../infrastructure/ingest-adapters/adapterRegistry.js";
import type { SessionResolver } from "../sessions/sessionResolver.js";
import { buildIngestAdapterConnectContext } from "./buildIngestAdapterConnectContext.js";
import { ingestNormalizedToRaw } from "./ingestMessageMapper.js";
import { ingestConnectionStatus } from "./ingestConnectionStatus.js";
import { workerRuntimeStatus } from "../workerRuntimeStatus.js";

/** Первая пауза после неудачного connect/duty (пока не было live). */
const CONNECT_BACKOFF_MS_INITIAL = 5_000;
/** Потолок остывания перед следующей попыткой. */
const CONNECT_BACKOFF_MS_MAX = 120_000;

type AdapterEntry = { providerId: string; stop: () => Promise<void> };

/**
 * Use case: загрузить active providers, подключить adapters, sink → IngestRawMessageHandler.
 * Пока нет live — backoff до 2 мин и повтор connect/duty; процесс не умирает и остаётся healthy.
 */
export class IngestOrchestrator {
  private running = false;
  private adapters: AdapterEntry[] = [];
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private lifecycleAbort: AbortController | null = null;

  constructor(
    private readonly providers: IIngestProviderRepository,
    private readonly bindings: IIngestBindingRepository,
    private readonly channels: IChannelRepository,
    private readonly ingestHandler: IngestRawMessageHandler,
    private readonly events: IEventPublisher,
    private readonly sessionResolver: SessionResolver,
    private readonly telegramMtprotoApp: TelegramMtprotoAppCredentials,
  ) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.lifecycleAbort = new AbortController();
    const signal = this.lifecycleAbort.signal;

    const activeProviders = await this.providers.listActive();
    console.log(`Ingest orchestrator: ${activeProviders.length} active provider(s).`);

    let totalBindings = 0;
    for (const provider of activeProviders) {
      const enabled = (await this.bindings.listByProvider(provider.id)).filter((b) => b.enabled);
      totalBindings += enabled.length;
    }

    // Сразу running: bootstrap не ждёт MTProxy — иначе /health → unhealthy на весь стартовый fail.
    workerRuntimeStatus.setOrchestrator({
      running: true,
      providerCount: activeProviders.length,
      bindingCount: totalBindings,
    });

    this.heartbeatTimer = setInterval(() => {
      void this.touchProviderHeartbeats(activeProviders.map((p) => p.id));
    }, 30_000);

    for (const provider of activeProviders) {
      void this.superviseUntilLive(provider, signal);
    }
  }

  /**
   * Пока не live: connect → duty; при ошибке — остывание (cap 2 мин) и повтор.
   * После live GramJS сам reconnect'ит TCP; цикл сюда не возвращается.
   */
  private async superviseUntilLive(
    provider: IngestProviderRecord,
    signal: AbortSignal,
  ): Promise<void> {
    let backoffMs = CONNECT_BACKOFF_MS_INITIAL;

    while (this.running && !signal.aborted) {
      try {
        await this.bringUpProvider(provider);
        return;
      } catch (err) {
        if (!this.running || signal.aborted) return;

        const message = err instanceof Error ? err.message : String(err);
        await this.providers.updateStatus(provider.id, "error", message);
        workerRuntimeStatus.setError(message);
        ingestConnectionStatus.setDutyActive(provider.id, false);
        ingestConnectionStatus.set({
          providerId: provider.id,
          providerKey: provider.key,
          phase: "reconnecting",
          detail: `Connect/duty fail: ${message}. Повтор через ${Math.round(backoffMs / 1000)}с`,
        });
        console.error(
          `Provider ${provider.key}: нет live (${message}). Backoff ${backoffMs}ms…`,
        );

        const ok = await this.waitBackoff(backoffMs, signal);
        if (!ok) return;
        backoffMs = Math.min(backoffMs * 2, CONNECT_BACKOFF_MS_MAX);
      }
    }
  }

  /** Один проход connect + startDuty. При ошибке чистит adapter. */
  private async bringUpProvider(provider: IngestProviderRecord): Promise<void> {
    ingestConnectionStatus.set({
      providerId: provider.id,
      providerKey: provider.key,
      phase: "connecting",
      detail: "Старт MTProto…",
    });

    const providerBindings = (await this.bindings.listByProvider(provider.id)).filter(
      (b) => b.enabled,
    );
    if (providerBindings.length === 0) {
      console.log(`Provider ${provider.key}: нет enabled bindings.`);
      ingestConnectionStatus.set({
        providerId: provider.id,
        providerKey: provider.key,
        phase: "disconnected",
        detail: "Нет enabled bindings",
      });
      return;
    }

    const channelKeyByBinding = new Map<string, string>();
    for (const binding of providerBindings) {
      if (!binding.channelId) {
        console.warn(`Binding ${binding.bindingKey}: channelId не задан.`);
        continue;
      }
      const channel = await this.channels.findById(binding.channelId);
      if (!channel) {
        console.warn(`Binding ${binding.bindingKey}: channel не найден.`);
        continue;
      }
      channelKeyByBinding.set(binding.id, channel.key);
    }

    const adapter = createRawIngestAdapter(provider.adapterKind, this.sessionResolver);
    if ("setChannelKeyMap" in adapter && typeof adapter.setChannelKeyMap === "function") {
      adapter.setChannelKeyMap(channelKeyByBinding);
    }

    try {
      await adapter.connect(
        buildIngestAdapterConnectContext({
          provider,
          sessionResolver: this.sessionResolver,
          telegramMtprotoApp: this.telegramMtprotoApp,
        }),
      );

      const sink = async (normalized: IngestNormalizedMessage) => {
        const { raw, extension } = ingestNormalizedToRaw(normalized);
        await this.ingestHandler.handle(raw, extension);
      };

      await adapter.startDuty(providerBindings, sink);
      await this.providers.updateStatus(provider.id, "active", null);
      workerRuntimeStatus.clearError();
      ingestConnectionStatus.setDutyActive(provider.id, true);
      ingestConnectionStatus.set({
        providerId: provider.id,
        providerKey: provider.key,
        phase: "live",
        detail: `Слушает ${providerBindings.length} binding(s)`,
      });
      await this.providers.touchHeartbeat(provider.id);

      this.adapters.push({
        providerId: provider.id,
        stop: () => adapter.stop(),
      });
    } catch (err) {
      await adapter.stop().catch(() => undefined);
      this.adapters = this.adapters.filter((a) => a.providerId !== provider.id);

      const message = err instanceof Error ? err.message : String(err);
      await this.events.publish([
        buildDomainEvent({
          type: "IngestSourceUnavailable",
          aggregateType: "ingest_provider",
          aggregateId: provider.id,
          payload: { providerKey: provider.key, reason: message },
        }),
      ]);
      throw err;
    }
  }

  private async waitBackoff(ms: number, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return false;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
    return !signal.aborted && this.running;
  }

  private async touchProviderHeartbeats(providerIds: string[]): Promise<void> {
    workerRuntimeStatus.touchHeartbeat();
    for (const id of providerIds) {
      try {
        await this.providers.touchHeartbeat(id);
      } catch {
        /* probe не должен падать из-за heartbeat */
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.lifecycleAbort?.abort();
    this.lifecycleAbort = null;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    workerRuntimeStatus.setOrchestrator({
      running: false,
      providerCount: 0,
      bindingCount: 0,
    });
    ingestConnectionStatus.clearAll();
    for (const entry of this.adapters) {
      await entry.stop();
    }
    this.adapters = [];
  }

  /** Одноразовый backfill chunk для binding (CLI). */
  async runBackfillChunk(input: {
    providerId: string;
    bindingId: string;
    batchSize?: number;
    fromPostedAt?: string;
    toPostedAt?: string;
    fromExternalId?: string;
    toExternalId?: string;
    /** После каждого сообщения в чанке (CLI progress). */
    onIngest?: (result: { inserted: boolean }) => void;
  }): Promise<{ inserted: number; duplicates: number }> {
    const provider = await this.providers.findById(input.providerId);
    if (!provider) throw new Error(`Provider not found: ${input.providerId}`);

    const binding = await this.bindings.findById(input.bindingId);
    if (!binding) throw new Error(`Binding not found: ${input.bindingId}`);

    const channel = binding.channelId
      ? await this.channels.findById(binding.channelId)
      : null;
    if (!channel) throw new Error(`Channel not found for binding ${input.bindingId}`);

    const adapter = createRawIngestAdapter(provider.adapterKind, this.sessionResolver);
    if ("setChannelKeyMap" in adapter && typeof adapter.setChannelKeyMap === "function") {
      adapter.setChannelKeyMap(new Map([[binding.id, channel.key]]));
    }

    const config = (provider.adapterConfig ?? {}) as { historyBatchSize?: number };
    const effectiveBatchSize = input.batchSize ?? config.historyBatchSize ?? 200;

    await adapter.connect(
      buildIngestAdapterConnectContext({
        provider,
        sessionResolver: this.sessionResolver,
        telegramMtprotoApp: this.telegramMtprotoApp,
      }),
    );

    let totals = { inserted: 0, duplicates: 0 };
    try {
      if (!adapter.fetchHistoryBatch) {
        throw new Error("Adapter does not support fetchHistoryBatch");
      }

      const sink = async (normalized: IngestNormalizedMessage) => {
        const { raw, extension } = ingestNormalizedToRaw(normalized, "backfill");
        const result = await this.ingestHandler.handle(raw, extension);
        input.onIngest?.(result);
        return result;
      };

      totals = await adapter.fetchHistoryBatch(
        binding,
        {
          batchSize: effectiveBatchSize,
          fromPostedAt: input.fromPostedAt,
          toPostedAt: input.toPostedAt,
          fromExternalId: input.fromExternalId,
          toExternalId: input.toExternalId,
        },
        sink,
      );
    } finally {
      await adapter.stop();
    }

    await this.events.publish([
      buildDomainEvent({
        type: "IngestBackfillChunkCompleted",
        aggregateType: "ingest_binding",
        aggregateId: binding.id,
        payload: {
          providerKey: provider.key,
          bindingKey: binding.bindingKey,
          stats: totals,
          jobId: randomUUID(),
        },
      }),
    ]);

    return totals;
  }
}
