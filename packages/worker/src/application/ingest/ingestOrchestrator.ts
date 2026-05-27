import type {
  IChannelRepository,
  IEventPublisher,
  IIngestBindingRepository,
  IIngestProviderRepository,
  IngestNormalizedMessage,
} from "@radar/shared";
import { randomUUID } from "node:crypto";
import { buildDomainEvent } from "../handlers/domainEventFactory.js";
import type { IngestRawMessageHandler } from "../handlers/ingestRawMessageHandler.js";
import { createRawIngestAdapter } from "../../infrastructure/ingest-adapters/adapterRegistry.js";
import type { SessionResolver } from "../sessions/sessionResolver.js";
import { ingestNormalizedToRaw } from "./ingestMessageMapper.js";

function resolveMtproxyFromEnv(): { ip: string; port: number; secret: string } | null {
  const ip = process.env.TELEGRAM_MTPROXY_HOST?.trim();
  const port = Number(process.env.TELEGRAM_MTPROXY_PORT);
  const secret = process.env.TELEGRAM_MTPROXY_SECRET?.trim();
  if (!ip || !port || !secret) return null;
  return { ip, port, secret };
}

/**
 * Use case: загрузить active providers, подключить adapters, sink → IngestRawMessageHandler.
 */
export class IngestOrchestrator {
  private running = false;
  private adapters: Array<{ providerId: string; stop: () => Promise<void> }> = [];

  constructor(
    private readonly providers: IIngestProviderRepository,
    private readonly bindings: IIngestBindingRepository,
    private readonly channels: IChannelRepository,
    private readonly ingestHandler: IngestRawMessageHandler,
    private readonly events: IEventPublisher,
    private readonly sessionResolver: SessionResolver,
  ) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const activeProviders = await this.providers.listActive();
    console.log(`Ingest orchestrator: ${activeProviders.length} active provider(s).`);

    for (const provider of activeProviders) {
      try {
        const providerBindings = (await this.bindings.listByProvider(provider.id)).filter(
          (b) => b.enabled,
        );
        if (providerBindings.length === 0) {
          console.log(`Provider ${provider.key}: нет enabled bindings.`);
          continue;
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

        await adapter.connect({
          provider,
          resolveSessionSecret: async (slotKey) => {
            const material = await this.sessionResolver.resolveMaterial(
              slotKey,
              slotKey.includes("bot") ? "bot_token" : "mtproto_user",
            );
            return material.secret;
          },
          resolveMtproxy: resolveMtproxyFromEnv,
        });

        const sink = async (normalized: IngestNormalizedMessage) => {
          const { raw, extension } = ingestNormalizedToRaw(normalized);
          await this.ingestHandler.handle(raw, extension);
        };

        void adapter
          .startDuty(providerBindings, sink)
          .catch(async (err) => {
            const message = err instanceof Error ? err.message : String(err);
            await this.providers.updateStatus(provider.id, "error", message);
            await this.events.publish([
              buildDomainEvent({
                type: "IngestSourceUnavailable",
                aggregateType: "ingest_provider",
                aggregateId: provider.id,
                payload: { providerKey: provider.key, reason: message },
              }),
            ]);
            console.error(`Provider ${provider.key} duty failed:`, err);
          });

        await this.providers.touchHeartbeat(provider.id);

        this.adapters.push({
          providerId: provider.id,
          stop: () => adapter.stop(),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.providers.updateStatus(provider.id, "error", message);
        console.error(`Provider ${provider.key} connect failed:`, err);
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
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

    // Читаем historyBatchSize из adapterConfig, если не передан явно
    const config = provider.adapterConfig as any;
    const effectiveBatchSize = input.batchSize ?? config.historyBatchSize ?? 200;

    await adapter.connect({
      provider,
      resolveSessionSecret: async (slotKey) => {
        const material = await this.sessionResolver.resolveMaterial(slotKey, "mtproto_user");
        return material.secret;
      },
      resolveMtproxy: resolveMtproxyFromEnv,
    });

    let totals = { inserted: 0, duplicates: 0 };
    try {
      if (!adapter.fetchHistoryBatch) {
        throw new Error("Adapter does not support fetchHistoryBatch");
      }

      const sink = async (normalized: IngestNormalizedMessage) => {
        const { raw, extension } = ingestNormalizedToRaw(normalized, "backfill");
        await this.ingestHandler.handle(raw, extension);
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
