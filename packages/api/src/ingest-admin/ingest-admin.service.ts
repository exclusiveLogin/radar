import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import {
  backfillJobListItemSchema,
  backfillJobRecordSchema,
  backfillJobsQuerySchema,
  channelAdminItemSchema,
  channelStatsSchema,
  createBackfillJobSchema,
  createIngestBindingSchema,
  createIngestProviderSchema,
  ingestBindingRecordSchema,
  ingestProviderRecordSchema,
  ingestMessageHash,
  manualIngestRequestSchema,
  manualIngestResponseSchema,
  timelineQuerySchema,
  timelineResponseSchema,
  updateIngestProviderSchema,
  buildBackfillJobProgress,
  resolveBackfillRoundRobinSlice,
  type BackfillJobListItem,
  type BackfillJobRecord,
  type ChannelAdminItem,
  type ChannelStats,
  type CreateIngestBinding,
  type CreateIngestProvider,
  type CreateBackfillJob,
  type DomainEvent,
  defaultTopicForEvent,
  type IngestBindingRecord,
  type IngestProviderRecord,
  type ManualIngestRequest,
  type RawMessage,
  type TimelineQuery,
  type UpdateIngestProvider,
} from "@radar/shared";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { MANUAL_ADMIN_PROVIDER_KEY } from "./ingest-admin.constants";
import { Inject } from "@nestjs/common";
import {
  INGEST_ADMIN_DEPENDENCIES,
  type IngestAdminDependencies,
} from "./ingest-admin.providers";

const updateIngestBindingBodySchema = z.object({
  enabled: z.boolean(),
});

const providerDetailSchema = z.object({
  provider: ingestProviderRecordSchema,
  bindings: z.array(ingestBindingRecordSchema),
});

@Injectable()
export class IngestAdminService implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject(INGEST_ADMIN_DEPENDENCIES)
    private readonly deps: IngestAdminDependencies,
  ) {}

  /** RMQ transport для admin ingest wake (confirm + retry, без outbox). */
  async onModuleInit(): Promise<void> {
    await this.deps.transport.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.deps.transport.stop();
  }

  /** Список всех ingest-провайдеров (включая draft/paused). */
  async listProviders(): Promise<IngestProviderRecord[]> {
    const rows = await this.deps.providers.listAll();
    return rows.map((r) => ingestProviderRecordSchema.parse(r));
  }

  /** Карточка провайдера с привязками к каналам. */
  async getProvider(id: string) {
    const provider = await this.requireProvider(id);
    const bindings = await this.deps.bindings.listByProvider(id);
    return providerDetailSchema.parse({ provider, bindings });
  }

  /** Регистрация нового провайдера (стартовый status=draft в репозитории). */
  async createProvider(body: unknown): Promise<IngestProviderRecord> {
    const input = createIngestProviderSchema.parse(body) satisfies CreateIngestProvider;
    const created = await this.deps.providers.create(input);
    return ingestProviderRecordSchema.parse(created);
  }

  /** Обновление title/status/adapterConfig/credentialRefs. */
  async updateProvider(id: string, body: unknown): Promise<IngestProviderRecord> {
    await this.requireProvider(id);
    const input = updateIngestProviderSchema.parse(body) satisfies UpdateIngestProvider;
    const updated = await this.deps.providers.update(id, input);
    return ingestProviderRecordSchema.parse(updated);
  }

  /** Привязка канала к провайдеру (создаёт channel при channelKey). */
  async createBinding(providerId: string, body: unknown): Promise<IngestBindingRecord> {
    await this.requireProvider(providerId);
    const input = createIngestBindingSchema.parse(body) satisfies CreateIngestBinding;
    const created = await this.deps.bindings.create(providerId, input);
    return ingestBindingRecordSchema.parse(created);
  }

  /** Включение/выключение binding без удаления записи. */
  async updateBinding(id: string, body: unknown): Promise<IngestBindingRecord> {
    const existing = await this.deps.bindings.findById(id);
    if (!existing) {
      throw new NotFoundException(`Ingest binding not found: ${id}`);
    }
    const { enabled } = updateIngestBindingBodySchema.parse(body);
    await this.deps.bindings.updateEnabled(id, enabled);
    const updated = await this.deps.bindings.findById(id);
    return ingestBindingRecordSchema.parse(updated);
  }

  /** Активация дежурства: worker подхватит status=active. */
  async startProvider(id: string): Promise<IngestProviderRecord> {
    await this.requireProvider(id);
    await this.deps.providers.updateStatus(id, "active", null);
    return ingestProviderRecordSchema.parse(await this.requireProvider(id));
  }

  /** Пауза дежурства: status=paused. */
  async stopProvider(id: string): Promise<IngestProviderRecord> {
    await this.requireProvider(id);
    await this.deps.providers.updateStatus(id, "paused", null);
    return ingestProviderRecordSchema.parse(await this.requireProvider(id));
  }

  /** Ручной ingest: raw DB → RMQ publishConfirmed (ошибка → UI, ретрай руками). */
  async manualIngest(body: unknown) {
    const input = manualIngestRequestSchema.parse(body) satisfies ManualIngestRequest;
    const { channelKey, binding } = await this.resolveManualChannel(input);
    const provider = await this.ensureManualAdminProvider();
    await this.ensureManualBinding(provider.id, channelKey, binding?.id);

    const postedAt = input.postedAt ?? new Date().toISOString();
    const externalMessageId = randomUUID();
    const rawPayload = input.meta ? { manual: input.meta } : {};

    const raw: RawMessage = {
      channelKey,
      providerKey: MANUAL_ADMIN_PROVIDER_KEY,
      sourceKind: "manual",
      externalMessageId,
      postedAt,
      ingestMode: "manual",
      rawText: input.rawText,
      rawPayload,
      hash: ingestMessageHash({
        channelKey,
        providerKey: MANUAL_ADMIN_PROVIDER_KEY,
        sourceKind: "manual",
        externalMessageId,
        postedAt,
        rawText: input.rawText,
        rawPayload,
      }),
      fetchedAt: new Date().toISOString(),
    };

    const result = await this.deps.rawMessages.upsert(raw);
    await this.publishRawMessageEvent(raw, result.id, result.inserted);

    return manualIngestResponseSchema.parse({
      rawMessageId: result.id,
      inserted: result.inserted,
      parseScheduled: result.inserted,
    });
  }

  /** Timeline сырья с anchor-пагинацией (asc/desc, before/after). */
  async listMessages(query: Record<string, unknown>) {
    const parsed = timelineQuerySchema.parse(query) satisfies TimelineQuery;
    const result = await this.deps.rawMessages.listTimeline(parsed);
    return timelineResponseSchema.parse(result);
  }

  /** Постановка backfill-задачи по bindingId. */
  async createBackfillJob(body: unknown) {
    const input = createBackfillJobSchema.parse(body) satisfies CreateBackfillJob;
    const binding = await this.deps.bindings.findById(input.bindingId);
    if (!binding) {
      throw new NotFoundException(`Ingest binding not found: ${input.bindingId}`);
    }
    const created = await this.deps.backfillJobs.create({
      ...input,
      providerId: binding.providerId,
    });
    return backfillJobRecordSchema.parse(created);
  }

  /** Список backfill-задач с прогрессом и каналом (мониторинг в админке). */
  async listBackfillJobs(query: Record<string, unknown>): Promise<BackfillJobListItem[]> {
    const filter = backfillJobsQuerySchema.parse(query);
    const rows = await this.deps.backfillJobs.findMany(filter);
    return Promise.all(rows.map((row) => this.toJobListItem(row)));
  }

  /** Карточка одной backfill-задачи. */
  async getBackfillJob(id: string): Promise<BackfillJobListItem> {
    const row = await this.deps.backfillJobs.findById(id);
    if (!row) {
      throw new NotFoundException(`Backfill job not found: ${id}`);
    }
    return this.toJobListItem(row);
  }

  /**
   * Убрать job: для pending/running сначала cancel (демон прервёт батч), затем DELETE строки.
   * Для terminal — сразу удаление из мониторинга.
   */
  async removeBackfillJob(id: string): Promise<{ ok: true; removed: true }> {
    const row = await this.deps.backfillJobs.findById(id);
    if (!row) {
      throw new NotFoundException(`Backfill job not found: ${id}`);
    }
    if (row.status === "pending" || row.status === "running") {
      await this.deps.backfillJobs.requestCancel(id);
    }
    const removed = await this.deps.backfillJobs.delete(id);
    if (!removed) {
      throw new NotFoundException(`Backfill job not found: ${id}`);
    }
    return { ok: true, removed: true };
  }

  /** Запрос отмены: pending/running → canceled (демон прервёт стрим). */
  async cancelBackfillJob(id: string): Promise<BackfillJobListItem> {
    const updated = await this.deps.backfillJobs.requestCancel(id);
    if (!updated) {
      throw new NotFoundException(`Backfill job not found: ${id}`);
    }
    return this.toJobListItem(updated);
  }

  /** Список каналов со статусом «слушается» (provider active + binding enabled + channel enabled). */
  async listChannels(): Promise<ChannelAdminItem[]> {
    const rows = await this.deps.channels.findAllForAdmin();
    return rows.map((row) =>
      channelAdminItemSchema.parse({
        id: row.id,
        key: row.key,
        title: row.title,
        telegramTarget: row.telegramTarget,
        enabled: row.enabled,
        sourceKind: row.sourceKind,
        providerId: row.providerId,
        bindingId: row.bindingId,
        providerStatus: row.providerStatus,
        bindingEnabled: row.bindingEnabled,
        listening: row.enabled && row.hasActiveEnabledBinding,
        lastRawPostedAt: row.lastRawPostedAt,
      }),
    );
  }

  /** Агрегаты сообщений/парсинга по одному каналу. */
  async getChannelStats(channelKey: string): Promise<ChannelStats> {
    const [raw] = await this.deps.dataSource.query<
      Array<{
        raw_total: string;
        live: string;
        backfill: string;
        manual: string;
        last_posted_at: Date | null;
      }>
    >(
      `SELECT
         COUNT(*) AS raw_total,
         COUNT(*) FILTER (WHERE rm.ingest_mode = 'live') AS live,
         COUNT(*) FILTER (WHERE rm.ingest_mode = 'backfill') AS backfill,
         COUNT(*) FILTER (WHERE rm.ingest_mode = 'manual') AS manual,
         MAX(rm.posted_at) AS last_posted_at
       FROM mat_ingest_raw rm
       JOIN channels c ON c.id = rm.channel_id
       WHERE c.key = $1`,
      [channelKey],
    );

    const [parse] = await this.deps.dataSource.query<
      Array<{ parsed_ok: string; parse_failed: string; parse_skipped: string }>
    >(
      `SELECT
         COUNT(*) FILTER (WHERE pa.status = 'ok') AS parsed_ok,
         COUNT(*) FILTER (WHERE pa.status = 'failed') AS parse_failed,
         COUNT(*) FILTER (WHERE pa.status = 'skipped') AS parse_skipped
       FROM log_parse_attempt pa
       JOIN mat_ingest_raw rm ON rm.id = pa.raw_message_id
       JOIN channels c ON c.id = rm.channel_id
       WHERE c.key = $1`,
      [channelKey],
    );

    return channelStatsSchema.parse({
      channelKey,
      rawTotal: Number(raw?.raw_total ?? 0),
      live: Number(raw?.live ?? 0),
      backfill: Number(raw?.backfill ?? 0),
      manual: Number(raw?.manual ?? 0),
      parsedOk: Number(parse?.parsed_ok ?? 0),
      parseFailed: Number(parse?.parse_failed ?? 0),
      parseSkipped: Number(parse?.parse_skipped ?? 0),
      lastPostedAt: raw?.last_posted_at?.toISOString() ?? null,
    });
  }

  /** Маппинг записи job → элемент списка: канал + развёрнутый прогресс. */
  private async toJobListItem(row: BackfillJobRecord): Promise<BackfillJobListItem> {
    const checkpoint = this.readCheckpoint(row.params);
    const channelKey = await this.resolveJobChannelKey(row.bindingId);
    return backfillJobListItemSchema.parse({
      ...row,
      channelKey,
      progress: buildBackfillJobProgress({
        strategy: row.strategy,
        params: row.params,
        stats: row.stats,
        checkpointOffsetId: checkpoint?.offsetId ?? null,
        checkpointPostedAt: checkpoint?.postedAt ?? null,
      }),
      roundRobinSlice: resolveBackfillRoundRobinSlice(row.status, row.params),
    });
  }

  private async resolveJobChannelKey(bindingId: string): Promise<string | null> {
    const binding = await this.deps.bindings.findById(bindingId);
    if (!binding?.channelId) return null;
    const channel = await this.deps.channels.findById(binding.channelId);
    return channel?.key ?? null;
  }

  private readCheckpoint(
    params: Record<string, unknown>,
  ): { offsetId: string; postedAt: string } | null {
    const raw = params.checkpoint;
    if (!raw || typeof raw !== "object") return null;
    const cp = raw as { offsetId?: unknown; postedAt?: unknown };
    if (typeof cp.offsetId !== "string" || typeof cp.postedAt !== "string") return null;
    return { offsetId: cp.offsetId, postedAt: cp.postedAt };
  }

  private async requireProvider(id: string): Promise<IngestProviderRecord> {
    const provider = await this.deps.providers.findById(id);
    if (!provider) {
      throw new NotFoundException(`Ingest provider not found: ${id}`);
    }
    return ingestProviderRecordSchema.parse(provider);
  }

  private async ensureManualAdminProvider(): Promise<IngestProviderRecord> {
    const existing = await this.deps.providers.findByKey(MANUAL_ADMIN_PROVIDER_KEY);
    if (existing) {
      return ingestProviderRecordSchema.parse(existing);
    }
    const created = await this.deps.providers.create({
      key: MANUAL_ADMIN_PROVIDER_KEY,
      title: "Manual admin ingest",
      adapterKind: "manual",
      adapterConfig: { kind: "manual" },
    });
    await this.deps.providers.updateStatus(created.id, "active");
    return ingestProviderRecordSchema.parse(await this.requireProvider(created.id));
  }

  private async ensureManualBinding(
    providerId: string,
    channelKey: string,
    bindingId?: string,
  ): Promise<IngestBindingRecord | null> {
    if (bindingId) {
      const binding = await this.deps.bindings.findById(bindingId);
      if (!binding) {
        throw new NotFoundException(`Ingest binding not found: ${bindingId}`);
      }
      return ingestBindingRecordSchema.parse(binding);
    }

    const channel = await this.deps.channels.findByKey(channelKey);
    if (!channel) return null;

    const bindings = await this.deps.bindings.listByProvider(providerId);
    const existing = bindings.find((b) => b.channelId === channel.id);
    if (existing) {
      return ingestBindingRecordSchema.parse(existing);
    }

    const created = await this.deps.bindings.create(providerId, {
      bindingKey: `manual:${channelKey}`,
      channelId: channel.id,
      externalTarget: channelKey,
      bindingMode: "bot_api_dm",
      enabled: true,
    });
    return ingestBindingRecordSchema.parse(created);
  }

  private async resolveManualChannel(input: ManualIngestRequest): Promise<{
    channelKey: string;
    binding: IngestBindingRecord | null;
  }> {
    if (input.bindingId) {
      const binding = await this.deps.bindings.findById(input.bindingId);
      if (!binding?.channelId) {
        throw new BadRequestException("Binding has no linked channel");
      }
      const channel = await this.deps.channels.findById(binding.channelId);
      if (!channel) {
        throw new NotFoundException(`Channel not found for binding: ${input.bindingId}`);
      }
      return {
        channelKey: channel.key,
        binding: ingestBindingRecordSchema.parse(binding),
      };
    }

    if (!input.channelKey) {
      throw new BadRequestException("channelKey or bindingId is required");
    }

    const channel = await this.deps.channels.upsert({
      key: input.channelKey,
      telegramTarget: input.channelKey,
      title: input.channelKey,
      sourceKind: "manual",
    });

    return { channelKey: channel.key, binding: null };
  }

  private async publishRawMessageEvent(
    raw: RawMessage,
    aggregateId: string,
    inserted: boolean,
  ): Promise<void> {
    const event: DomainEvent = {
      id: randomUUID(),
      type: inserted ? "RawMessageIngested" : "RawMessageDuplicate",
      version: 1,
      occurredAt: new Date().toISOString(),
      aggregateType: "raw_message",
      aggregateId,
      payload: {
        channelKey: raw.channelKey,
        providerKey: raw.providerKey,
        hash: raw.hash,
        materializationIds: [aggregateId],
      },
    };
    const topic = defaultTopicForEvent(event.type);
    if (!topic) return;
    await this.deps.transport.publish(topic, [event]);
  }
}
