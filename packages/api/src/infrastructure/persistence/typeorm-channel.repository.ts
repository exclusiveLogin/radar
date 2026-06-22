import type { ChannelRecord, IChannelRepository } from "@radar/shared";
import type { DataSource } from "typeorm";
import { ChannelEntity } from "../../ingest/entities";

function toChannelRecord(row: ChannelEntity): ChannelRecord {
  return {
    id: row.id,
    key: row.key,
    telegramTarget: row.telegramTarget,
    title: row.title,
    enabled: row.enabled,
    parseOverrides: row.parseOverrides,
    providerId: row.providerId,
    bindingId: row.bindingId,
    sourceKind: row.sourceKind,
  };
}

/** Строка канала для админки: метаданные + агрегаты по binding/provider. */
export type ChannelAdminRow = {
  id: string;
  key: string;
  title: string | null;
  telegramTarget: string;
  enabled: boolean;
  sourceKind: string;
  providerId: string | null;
  bindingId: string | null;
  providerStatus: string | null;
  bindingEnabled: boolean | null;
  hasActiveEnabledBinding: boolean;
  lastRawPostedAt: string | null;
};

type ChannelAdminSqlRow = {
  id: string;
  key: string;
  title: string | null;
  telegram_target: string;
  enabled: boolean;
  source_kind: string;
  provider_id: string | null;
  binding_id: string | null;
  resolved_binding_id: string | null;
  resolved_provider_id: string | null;
  provider_status: string | null;
  binding_enabled: boolean | null;
  has_active_enabled_binding: boolean | null;
  last_raw_posted_at: Date | null;
};

export class TypeOrmChannelRepository implements IChannelRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Каналы для админки с представительным binding/provider и временем последнего raw.
   * `hasActiveEnabledBinding` — есть ли хотя бы один enabled binding с active provider.
   */
  async findAllForAdmin(): Promise<ChannelAdminRow[]> {
    const rows = await this.dataSource.query<ChannelAdminSqlRow[]>(
      `SELECT
         c.id, c.key, c.title, c.telegram_target, c.enabled, c.source_kind,
         c.provider_id, c.binding_id,
         pb.id AS resolved_binding_id,
         pb.provider_id AS resolved_provider_id,
         agg.provider_status,
         agg.binding_enabled,
         COALESCE(agg.has_active_enabled_binding, false) AS has_active_enabled_binding,
         lr.last_raw_posted_at
       FROM channels c
       LEFT JOIN LATERAL (
         SELECT b.id, b.provider_id
         FROM ingest_bindings b
         WHERE b.channel_id = c.id
         ORDER BY b.enabled DESC, b.binding_key ASC
         LIMIT 1
       ) pb ON true
       LEFT JOIN LATERAL (
         SELECT
           bool_or(b.enabled AND p.status = 'active') AS has_active_enabled_binding,
           (array_agg(p.status ORDER BY (p.status = 'active') DESC))[1] AS provider_status,
           (array_agg(b.enabled ORDER BY b.enabled DESC))[1] AS binding_enabled
         FROM ingest_bindings b
         JOIN ingest_providers p ON p.id = b.provider_id
         WHERE b.channel_id = c.id
       ) agg ON true
       LEFT JOIN LATERAL (
         SELECT MAX(rm.posted_at) AS last_raw_posted_at
         FROM raw_messages rm
         WHERE rm.channel_id = c.id
       ) lr ON true
       ORDER BY c.key ASC`,
    );

    return rows.map((row) => ({
      id: row.id,
      key: row.key,
      title: row.title,
      telegramTarget: row.telegram_target,
      enabled: row.enabled,
      sourceKind: row.source_kind,
      providerId: row.provider_id ?? row.resolved_provider_id,
      bindingId: row.binding_id ?? row.resolved_binding_id,
      providerStatus: row.provider_status,
      bindingEnabled: row.binding_enabled,
      hasActiveEnabledBinding: Boolean(row.has_active_enabled_binding),
      lastRawPostedAt: row.last_raw_posted_at?.toISOString() ?? null,
    }));
  }

  async findByKey(key: string): Promise<ChannelRecord | null> {
    const row = await this.dataSource.getRepository(ChannelEntity).findOne({ where: { key } });
    return row ? toChannelRecord(row) : null;
  }

  async findById(id: string): Promise<ChannelRecord | null> {
    const row = await this.dataSource.getRepository(ChannelEntity).findOne({ where: { id } });
    return row ? toChannelRecord(row) : null;
  }

  async upsert(input: {
    key: string;
    telegramTarget: string;
    title?: string | null;
    enabled?: boolean;
    parseOverrides?: Record<string, unknown>;
    providerId?: string | null;
    bindingId?: string | null;
    sourceKind?: string;
  }): Promise<ChannelRecord> {
    const repo = this.dataSource.getRepository(ChannelEntity);
    let row = await repo.findOne({ where: { key: input.key } });
    if (!row) {
      row = repo.create({
        key: input.key,
        telegramTarget: input.telegramTarget,
        title: input.title ?? null,
        enabled: input.enabled ?? true,
        parseOverrides: input.parseOverrides ?? {},
        providerId: input.providerId ?? null,
        bindingId: input.bindingId ?? null,
        sourceKind: input.sourceKind ?? "telegram",
      });
    } else {
      row.telegramTarget = input.telegramTarget;
      if (input.title !== undefined) row.title = input.title;
      if (input.enabled !== undefined) row.enabled = input.enabled;
      if (input.parseOverrides !== undefined) row.parseOverrides = input.parseOverrides;
      if (input.providerId !== undefined) row.providerId = input.providerId;
      if (input.bindingId !== undefined) row.bindingId = input.bindingId;
      if (input.sourceKind !== undefined) row.sourceKind = input.sourceKind;
    }
    const saved = await repo.save(row);
    return toChannelRecord(saved);
  }
}
