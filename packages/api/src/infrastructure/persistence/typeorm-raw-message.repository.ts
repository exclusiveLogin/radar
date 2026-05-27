import type {
  DomainEvent,
  IDomainEventOutbox,
  IRawMessageRepository,
  RawMessage,
  RawMessageTelegramExtension,
  TimelineQuery,
} from "@radar/shared";
import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";
import { IsNull } from "typeorm";
import { ChannelEntity, RawMessageEntity } from "../../ingest/entities";
import { toRawMessage } from "./ingest-mappers";
import { TypeOrmRawMessageTelegramExtensionRepository } from "./typeorm-raw-message-telegram.repository";

/**
 * Persistence raw_messages. Insert-ветка — `dataSource.transaction` (raw + telegram).
 * @see ../../../../../docs/domain/contexts/ingest.md
 * @see ../../../../../docs/domain/unit-of-work-and-transactions.md
 */
export class TypeOrmRawMessageRepository implements IRawMessageRepository {
  private readonly telegramExt: TypeOrmRawMessageTelegramExtensionRepository;

  constructor(private readonly dataSource: DataSource) {
    this.telegramExt = new TypeOrmRawMessageTelegramExtensionRepository(dataSource);
  }

  async upsert(
    raw: RawMessage,
    extension?: RawMessageTelegramExtension,
  ): Promise<{ inserted: boolean; id: string }> {
    const existingByHash = await this.dataSource.getRepository(RawMessageEntity).findOne({
      where: { hash: raw.hash },
    });
    if (existingByHash) {
      return { inserted: false, id: existingByHash.id };
    }

    const channels = this.dataSource.getRepository(ChannelEntity);
    const channel = await channels.findOne({ where: { key: raw.channelKey } });
    if (!channel) {
      throw new Error(`Channel not found: ${raw.channelKey}`);
    }

    const repo = this.dataSource.getRepository(RawMessageEntity);
    const identityMatch = await repo.findOne({
      where: {
        channelId: channel.id,
        providerKey: raw.providerKey,
        externalMessageId: raw.externalMessageId,
        revisionKey: raw.revisionKey ?? IsNull(),
      },
    });
    if (identityMatch) {
      return { inserted: false, id: identityMatch.id };
    }

    if (extension && raw.sourceKind === "telegram") {
      const dupId = await this.telegramExt.findDuplicate(
        extension.chatId,
        extension.messageId,
        extension.editDate,
      );
      if (dupId) return { inserted: false, id: dupId };
    }

    const id = randomUUID();
    await this.dataSource.transaction(async (manager) => {
      const txRepo = manager.getRepository(RawMessageEntity);
      const row = txRepo.create({
        id,
        channelId: channel.id,
        providerKey: raw.providerKey,
        sourceKind: raw.sourceKind,
        externalMessageId: raw.externalMessageId,
        revisionKey: raw.revisionKey ?? null,
        sourceSequence: raw.sourceSequence ?? null,
        ingestMode: raw.ingestMode ?? "live",
        hash: raw.hash,
        postedAt: new Date(raw.postedAt),
        rawText: raw.rawText,
        rawPayload: raw.rawPayload ?? {},
        fetchedAt: raw.fetchedAt ? new Date(raw.fetchedAt) : new Date(),
      });
      await txRepo.save(row);

      if (extension && raw.sourceKind === "telegram") {
        await this.telegramExt.insertInTransaction(manager, {
          rawMessageId: id,
          chatId: extension.chatId,
          messageId: extension.messageId,
          editDate: extension.editDate,
          peerType: extension.peerType,
        });
      }
    });

    return { inserted: true, id };
  }

  async findById(id: string): Promise<RawMessage | null> {
    const row = await this.dataSource.getRepository(RawMessageEntity).findOne({
      where: { id },
      relations: { channel: true },
    });
    if (!row?.channel) return null;
    return toRawMessage(row, row.channel);
  }

  async findByHash(hash: string): Promise<{ id: string; raw: RawMessage } | null> {
    const row = await this.dataSource.getRepository(RawMessageEntity).findOne({
      where: { hash },
      relations: { channel: true },
    });
    if (!row?.channel) return null;
    return { id: row.id, raw: toRawMessage(row, row.channel) };
  }

  async listTimeline(query: TimelineQuery) {
    const channels = this.dataSource.getRepository(ChannelEntity);
    const channel = await channels.findOne({ where: { key: query.channelKey } });
    if (!channel) return { items: [], nextAnchor: null };

    const repo = this.dataSource.getRepository(RawMessageEntity);
    const qb = repo
      .createQueryBuilder("rm")
      .innerJoinAndSelect("rm.channel", "ch")
      .where("rm.channel_id = :channelId", { channelId: channel.id });

    const desc = query.order === "desc";
    if (query.anchorPostedAt && query.anchorTieBreaker) {
      const dir = query.direction ?? (desc ? "before" : "after");
      const op = dir === "before" ? (desc ? "<" : ">") : desc ? ">" : "<";
      qb.andWhere(
        `(rm.posted_at ${op} :anchorPostedAt OR (rm.posted_at = :anchorPostedAt AND COALESCE(rm.source_sequence, rm.external_message_id) ${op} :anchorTieBreaker))`,
        {
          anchorPostedAt: new Date(query.anchorPostedAt),
          anchorTieBreaker: query.anchorTieBreaker,
        },
      );
    }

    qb.orderBy("rm.posted_at", desc ? "DESC" : "ASC");
    qb.addOrderBy("rm.source_sequence", desc ? "DESC" : "ASC", "NULLS LAST");
    qb.take(query.limit);

    const rows = await qb.getMany();
    const items = rows.map((r) => toRawMessage(r, channel));

    const last = rows.at(-1);
    const nextAnchor =
      rows.length === query.limit && last
        ? {
            channelKey: query.channelKey,
            postedAtUtc: last.postedAt.toISOString(),
            tieBreaker: last.sourceSequence ?? last.externalMessageId,
            direction: (desc ? "before" : "after") as "before" | "after",
            limit: query.limit,
          }
        : null;

    return { items, nextAnchor };
  }
}

/** Outbox append через domain_events — cross-process ingest. */
export class TypeOrmDomainEventOutbox implements IDomainEventOutbox {
  constructor(private readonly dataSource: DataSource) {}

  async append(events: DomainEvent[]): Promise<void> {
    const { TypeOrmDomainEventRepository } = await import("./typeorm-domain-event.repository");
    const repo = new TypeOrmDomainEventRepository(this.dataSource);
    await repo.append(events);
  }
}
