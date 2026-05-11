import type { IRawMessageRepository, RawMessage } from "@radar/shared";
import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";
import { ChannelEntity } from "../../ingest/entities";
import { RawMessageEntity } from "../../ingest/entities";

export class TypeOrmRawMessageRepository implements IRawMessageRepository {
  constructor(private readonly dataSource: DataSource) {}async upsert(raw: RawMessage): Promise<{ inserted: boolean; id: string }> {
    const repo = this.dataSource.getRepository(RawMessageEntity);
    const channels = this.dataSource.getRepository(ChannelEntity);
    const existing = await repo.findOne({ where: { hash: raw.hash } });
    if (existing) {
      return { inserted: false, id: existing.id };
    }

    let channel = await channels.findOne({ where: { key: raw.channelKey } });
    if (!channel) {
      channel = channels.create({
        key: raw.channelKey,
        telegramTarget: raw.channelKey,
        title: null,
      });
      await channels.save(channel);
    }

    const inserted = repo.create({
      id: randomUUID(),
      channelId: channel.id,
      telegramMessageId: String(raw.telegramMessageId),
      hash: raw.hash,
      postedAt: new Date(raw.postedAt),
      rawText: raw.rawText,
      editDate: raw.editDate ? new Date(raw.editDate) : null,
      rawPayload: {},
    });
    await repo.save(inserted);
    return { inserted: true, id: inserted.id };
  }
}
