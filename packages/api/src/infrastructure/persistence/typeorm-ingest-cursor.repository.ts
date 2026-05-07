import type { IIngestCursorRepository } from "@radar/shared";
import type { DataSource } from "typeorm";
import { ChannelEntity } from "../../ingest/entities";
import { IngestCursorEntity } from "../../ingest/entities";

export class TypeOrmIngestCursorRepository implements IIngestCursorRepository {
  constructor(private readonly dataSource: DataSource) {}

  async advance(channelKey: string, messageId: number, postedAt: string): Promise<void> {
    const channels = this.dataSource.getRepository(ChannelEntity);
    const cursors = this.dataSource.getRepository(IngestCursorEntity);

    let channel = await channels.findOne({ where: { key: channelKey } });
    if (!channel) {
      channel = channels.create({
        key: channelKey,
        telegramTarget: channelKey,
        title: null,
      });
      await channels.save(channel);
    }

    await cursors.upsert(
      {
        channelId: channel.id,
        lastMessageId: String(messageId),
        lastPostedAt: new Date(postedAt),
      },
      ["channelId"],
    );
  }
}
