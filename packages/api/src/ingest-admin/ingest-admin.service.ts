import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import {
  backfillJobRecordSchema,
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
  type CreateIngestBinding,
  type CreateIngestProvider,
  type CreateBackfillJob,
  type DomainEvent,
  type IngestBindingRecord,
  type IngestProviderRecord,
  type ManualIngestRequest,
  type RawMessage,
  type TimelineQuery,
  type UpdateIngestProvider,
} from "@radar/shared";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DataSource } from "typeorm";
import {
  TypeOrmChannelRepository,
  TypeOrmDomainEventOutbox,
  TypeOrmIngestBackfillJobRepository,
  TypeOrmIngestBindingRepository,
  TypeOrmIngestProviderRepository,
  TypeOrmRawMessageRepository,
} from "../infrastructure/persistence";
import { MANUAL_ADMIN_PROVIDER_KEY } from "./ingest-admin.constants";

const updateIngestBindingBodySchema = z.object({
  enabled: z.boolean(),
});

const providerDetailSchema = z.object({
  provider: ingestProviderRecordSchema,
  bindings: z.array(ingestBindingRecordSchema),
});

@Injectable()
export class IngestAdminService {
  private readonly providers: TypeOrmIngestProviderRepository;
  private readonly bindings: TypeOrmIngestBindingRepository;
  private readonly channels: TypeOrmChannelRepository;
  private readonly rawMessages: TypeOrmRawMessageRepository;
  private readonly outbox: TypeOrmDomainEventOutbox;
  private readonly backfillJobs: TypeOrmIngestBackfillJobRepository;

  constructor(
    @InjectDataSource()
    dataSource: DataSource,
  ) {
    this.providers = new TypeOrmIngestProviderRepository(dataSource);
    this.bindings = new TypeOrmIngestBindingRepository(dataSource);
    this.channels = new TypeOrmChannelRepository(dataSource);
    this.rawMessages = new TypeOrmRawMessageRepository(dataSource);
    this.outbox = new TypeOrmDomainEventOutbox(dataSource);
    this.backfillJobs = new TypeOrmIngestBackfillJobRepository(dataSource);
  }

  /** Список всех ingest-провайдеров (включая draft/paused). */
  async listProviders(): Promise<IngestProviderRecord[]> {
    const rows = await this.providers.listAll();
    return rows.map((r) => ingestProviderRecordSchema.parse(r));
  }

  /** Карточка провайдера с привязками к каналам. */
  async getProvider(id: string) {
    const provider = await this.requireProvider(id);
    const bindings = await this.bindings.listByProvider(id);
    return providerDetailSchema.parse({ provider, bindings });
  }

  /** Регистрация нового провайдера (стартовый status=draft в репозитории). */
  async createProvider(body: unknown): Promise<IngestProviderRecord> {
    const input = createIngestProviderSchema.parse(body) satisfies CreateIngestProvider;
    const created = await this.providers.create(input);
    return ingestProviderRecordSchema.parse(created);
  }

  /** Обновление title/status/adapterConfig/credentialRefs. */
  async updateProvider(id: string, body: unknown): Promise<IngestProviderRecord> {
    await this.requireProvider(id);
    const input = updateIngestProviderSchema.parse(body) satisfies UpdateIngestProvider;
    const updated = await this.providers.update(id, input);
    return ingestProviderRecordSchema.parse(updated);
  }

  /** Привязка канала к провайдеру (создаёт channel при channelKey). */
  async createBinding(providerId: string, body: unknown): Promise<IngestBindingRecord> {
    await this.requireProvider(providerId);
    const input = createIngestBindingSchema.parse(body) satisfies CreateIngestBinding;
    const created = await this.bindings.create(providerId, input);
    return ingestBindingRecordSchema.parse(created);
  }

  /** Включение/выключение binding без удаления записи. */
  async updateBinding(id: string, body: unknown): Promise<IngestBindingRecord> {
    const existing = await this.bindings.findById(id);
    if (!existing) {
      throw new NotFoundException(`Ingest binding not found: ${id}`);
    }
    const { enabled } = updateIngestBindingBodySchema.parse(body);
    await this.bindings.updateEnabled(id, enabled);
    const updated = await this.bindings.findById(id);
    return ingestBindingRecordSchema.parse(updated);
  }

  /** Активация дежурства: worker подхватит status=active. */
  async startProvider(id: string): Promise<IngestProviderRecord> {
    await this.requireProvider(id);
    await this.providers.updateStatus(id, "active", null);
    return ingestProviderRecordSchema.parse(await this.requireProvider(id));
  }

  /** Пауза дежурства: status=paused. */
  async stopProvider(id: string): Promise<IngestProviderRecord> {
    await this.requireProvider(id);
    await this.providers.updateStatus(id, "paused", null);
    return ingestProviderRecordSchema.parse(await this.requireProvider(id));
  }

  /**
   * Ручной ingest атаки: канал + manual-admin, upsert raw_messages, событие в outbox.
   */
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

    const result = await this.rawMessages.upsert(raw);
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
    const result = await this.rawMessages.listTimeline(parsed);
    return timelineResponseSchema.parse(result);
  }

  /** Постановка backfill-задачи по bindingId. */
  async createBackfillJob(body: unknown) {
    const input = createBackfillJobSchema.parse(body) satisfies CreateBackfillJob;
    const binding = await this.bindings.findById(input.bindingId);
    if (!binding) {
      throw new NotFoundException(`Ingest binding not found: ${input.bindingId}`);
    }
    const created = await this.backfillJobs.create({
      ...input,
      providerId: binding.providerId,
    });
    return backfillJobRecordSchema.parse(created);
  }

  private async requireProvider(id: string): Promise<IngestProviderRecord> {
    const provider = await this.providers.findById(id);
    if (!provider) {
      throw new NotFoundException(`Ingest provider not found: ${id}`);
    }
    return ingestProviderRecordSchema.parse(provider);
  }

  private async ensureManualAdminProvider(): Promise<IngestProviderRecord> {
    const existing = await this.providers.findByKey(MANUAL_ADMIN_PROVIDER_KEY);
    if (existing) {
      return ingestProviderRecordSchema.parse(existing);
    }
    const created = await this.providers.create({
      key: MANUAL_ADMIN_PROVIDER_KEY,
      title: "Manual admin ingest",
      adapterKind: "manual",
      adapterConfig: { kind: "manual" },
    });
    await this.providers.updateStatus(created.id, "active");
    return ingestProviderRecordSchema.parse(await this.requireProvider(created.id));
  }

  private async ensureManualBinding(
    providerId: string,
    channelKey: string,
    bindingId?: string,
  ): Promise<IngestBindingRecord | null> {
    if (bindingId) {
      const binding = await this.bindings.findById(bindingId);
      if (!binding) {
        throw new NotFoundException(`Ingest binding not found: ${bindingId}`);
      }
      return ingestBindingRecordSchema.parse(binding);
    }

    const channel = await this.channels.findByKey(channelKey);
    if (!channel) return null;

    const bindings = await this.bindings.listByProvider(providerId);
    const existing = bindings.find((b) => b.channelId === channel.id);
    if (existing) {
      return ingestBindingRecordSchema.parse(existing);
    }

    const created = await this.bindings.create(providerId, {
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
      const binding = await this.bindings.findById(input.bindingId);
      if (!binding?.channelId) {
        throw new BadRequestException("Binding has no linked channel");
      }
      const channel = await this.channels.findById(binding.channelId);
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

    const channel = await this.channels.upsert({
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
      },
    };
    await this.outbox.append([event]);
  }
}
