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

export class TypeOrmChannelRepository implements IChannelRepository {
  constructor(private readonly dataSource: DataSource) {}

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
