import type { IIngestCursorRepository } from "@radar/shared";
import type { DataSource } from "typeorm";
import { ChannelEntity, IngestCursorEntity } from "../entities/ingest";

export class TypeOrmIngestCursorRepository implements IIngestCursorRepository {
  constructor(private readonly dataSource: DataSource) {}

  async advanceLive(input: {
    channelKey: string;
    providerKey: string;
    externalMessageId: string;
    postedAt: string;
    sourceSequence?: string | null;
    ingestMode: "live" | "backfill" | "manual";
  }): Promise<void> {
    if (input.ingestMode !== "live") return;

    const channels = this.dataSource.getRepository(ChannelEntity);
    const cursors = this.dataSource.getRepository(IngestCursorEntity);

    const channel = await channels.findOne({ where: { key: input.channelKey } });
    if (!channel) return;

    await cursors.upsert(
      {
        channelId: channel.id,
        providerKey: input.providerKey,
        liveLastExternalId: input.externalMessageId,
        liveLastPostedAt: new Date(input.postedAt),
        liveLastSourceSequence: input.sourceSequence ?? null,
        updatedAt: new Date(),
      },
      ["channelId", "providerKey"],
    );
  }

  async updateBackfillState(
    channelKey: string,
    providerKey: string,
    state: Record<string, unknown>,
  ): Promise<void> {
    const channels = this.dataSource.getRepository(ChannelEntity);
    const cursors = this.dataSource.getRepository(IngestCursorEntity);
    const channel = await channels.findOne({ where: { key: channelKey } });
    if (!channel) return;

    const existing = await cursors.findOne({
      where: { channelId: channel.id, providerKey },
    });
    const mergedState = { ...(existing?.backfillState ?? {}), ...state };
    if (existing) {
      existing.backfillState = mergedState;
      existing.updatedAt = new Date();
      await cursors.save(existing);
      return;
    }
    await cursors.save(
      cursors.create({
        channelId: channel.id,
        providerKey,
        backfillState: mergedState,
        externalCursor: {},
      }),
    );
  }

  async get(channelKey: string, providerKey: string) {
    const channels = this.dataSource.getRepository(ChannelEntity);
    const cursors = this.dataSource.getRepository(IngestCursorEntity);
    const channel = await channels.findOne({ where: { key: channelKey } });
    if (!channel) return null;

    const row = await cursors.findOne({
      where: { channelId: channel.id, providerKey },
    });
    if (!row) return null;

    return {
      liveLastExternalId: row.liveLastExternalId,
      liveLastPostedAt: row.liveLastPostedAt?.toISOString() ?? null,
      liveLastSourceSequence: row.liveLastSourceSequence,
      backfillState: row.backfillState,
      externalCursor: row.externalCursor,
    };
  }
}
