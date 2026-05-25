import type {
  CreateIngestBinding,
  IIngestBindingRepository,
  IngestBindingRecord,
} from "@radar/shared";
import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";
import { ChannelEntity, IngestBindingEntity } from "../../ingest/entities";
import { toBindingRecord } from "./ingest-mappers";

export class TypeOrmIngestBindingRepository implements IIngestBindingRepository {
  constructor(private readonly dataSource: DataSource) {}

  async listByProvider(providerId: string): Promise<IngestBindingRecord[]> {
    const rows = await this.dataSource.getRepository(IngestBindingEntity).find({
      where: { providerId },
      order: { bindingKey: "ASC" },
    });
    return rows.map(toBindingRecord);
  }

  async listEnabled(): Promise<IngestBindingRecord[]> {
    const rows = await this.dataSource.getRepository(IngestBindingEntity).find({
      where: { enabled: true },
      order: { bindingKey: "ASC" },
    });
    return rows.map(toBindingRecord);
  }

  async findById(id: string): Promise<IngestBindingRecord | null> {
    const row = await this.dataSource.getRepository(IngestBindingEntity).findOne({ where: { id } });
    return row ? toBindingRecord(row) : null;
  }

  async create(providerId: string, input: CreateIngestBinding): Promise<IngestBindingRecord> {
    const bindings = this.dataSource.getRepository(IngestBindingEntity);
    const channels = this.dataSource.getRepository(ChannelEntity);

    let channelId = input.channelId ?? null;
    if (!channelId && input.channelKey) {
      let channel = await channels.findOne({ where: { key: input.channelKey } });
      if (!channel) {
        channel = channels.create({
          key: input.channelKey,
          telegramTarget: input.externalTarget,
          title: input.channelKey,
        });
        await channels.save(channel);
      }
      channelId = channel.id;
    }

    const row = bindings.create({
      id: randomUUID(),
      providerId,
      channelId,
      bindingKey: input.bindingKey,
      enabled: input.enabled ?? true,
      externalTarget: input.externalTarget,
      bindingMode: input.bindingMode,
      parseOverrides: input.parseOverrides ?? {},
      adapterBinding: input.adapterBinding ?? {},
    });
    const saved = await bindings.save(row);
    return toBindingRecord(saved);
  }

  async updateEnabled(id: string, enabled: boolean): Promise<void> {
    await this.dataSource.getRepository(IngestBindingEntity).update({ id }, { enabled });
  }
}
