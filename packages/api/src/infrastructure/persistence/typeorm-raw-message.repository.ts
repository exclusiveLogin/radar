import type {
  DomainEvent,
  IDomainEventOutbox,
  IRawMessageRepository,
  RawMessage,
  RawMessageTelegramExtension,
  TimelineQuery,
} from "@radar/shared";
import { randomUUID } from "node:crypto";
import type { DataSource, EntityManager } from "typeorm";
import { IsNull } from "typeorm";
import { ChannelEntity, RawMessageEntity } from "../../ingest/entities";
import { toRawMessage } from "./ingest-mappers";
import { readTypeOrmQueryRows } from "./typeorm-query-rows";
import { TypeOrmRawMessageTelegramExtensionRepository } from "./typeorm-raw-message-telegram.repository";

/** PostgreSQL unique_violation (concurrent live poll / duplicate ingest). */
function isPgUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const driver =
    "driverError" in error
      ? (error as { driverError?: { code?: string } }).driverError
      : undefined;
  if (driver?.code === "23505") return true;
  return "code" in error && (error as { code: string }).code === "23505";
}

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
    const existingId = await this.resolveExistingId(raw, extension);
    if (existingId) {
      return { inserted: false, id: existingId };
    }

    const channels = this.dataSource.getRepository(ChannelEntity);
    const channel = await channels.findOne({ where: { key: raw.channelKey } });
    if (!channel) {
      throw new Error(`Channel not found: ${raw.channelKey}`);
    }

    const id = randomUUID();
    try {
      const insertedId = await this.dataSource.transaction(async (manager) =>
        this.insertRawMessage(manager, {
          id,
          channelId: channel.id,
          raw,
          extension,
        }),
      );
      if (!insertedId) {
        const duplicateId = await this.resolveExistingId(raw, extension, channel.id);
        if (!duplicateId) {
          throw new Error(`raw_messages hash conflict but row not found: ${raw.hash}`);
        }
        return { inserted: false, id: duplicateId };
      }
      return { inserted: true, id: insertedId };
    } catch (error) {
      if (!isPgUniqueViolation(error)) throw error;
      const duplicateId = await this.resolveExistingId(raw, extension, channel.id);
      if (!duplicateId) throw error;
      return { inserted: false, id: duplicateId };
    }
  }

  /** Быстрый duplicate-check до INSERT (TOCTOU закрываем ON CONFLICT + catch). */
  private async resolveExistingId(
    raw: RawMessage,
    extension?: RawMessageTelegramExtension,
    channelId?: string,
  ): Promise<string | null> {
    const existingByHash = await this.dataSource.getRepository(RawMessageEntity).findOne({
      where: { hash: raw.hash },
    });
    if (existingByHash) return existingByHash.id;

    let resolvedChannelId = channelId;
    if (!resolvedChannelId) {
      const channel = await this.dataSource.getRepository(ChannelEntity).findOne({
        where: { key: raw.channelKey },
      });
      if (!channel) return null;
      resolvedChannelId = channel.id;
    }

    const identityMatch = await this.dataSource.getRepository(RawMessageEntity).findOne({
      where: {
        channelId: resolvedChannelId,
        providerKey: raw.providerKey,
        externalMessageId: raw.externalMessageId,
        revisionKey: raw.revisionKey ?? IsNull(),
      },
    });
    if (identityMatch) return identityMatch.id;

    if (extension && raw.sourceKind === "telegram") {
      const dupId = await this.telegramExt.findDuplicate(
        extension.chatId,
        extension.messageId,
        extension.editDate,
      );
      if (dupId) return dupId;
    }

    return null;
  }

  /** INSERT … ON CONFLICT (hash) — без гонки live poll / parallel ingest. */
  private async insertRawMessage(
    manager: EntityManager,
    input: {
      id: string;
      channelId: string;
      raw: RawMessage;
      extension?: RawMessageTelegramExtension;
    },
  ): Promise<string | null> {
    const { id, channelId, raw, extension } = input;
    const rows = readTypeOrmQueryRows<{ id: string }>(
      await manager.query(
        `
        INSERT INTO raw_messages (
          id, channel_id, provider_key, source_kind, external_message_id,
          revision_key, source_sequence, ingest_mode, hash, posted_at,
          raw_text, raw_payload, fetched_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (hash) DO NOTHING
        RETURNING id
        `,
        [
          id,
          channelId,
          raw.providerKey,
          raw.sourceKind,
          raw.externalMessageId,
          raw.revisionKey ?? null,
          raw.sourceSequence ?? null,
          raw.ingestMode ?? "live",
          raw.hash,
          new Date(raw.postedAt),
          raw.rawText,
          raw.rawPayload ?? {},
          raw.fetchedAt ? new Date(raw.fetchedAt) : new Date(),
        ],
      ),
    );
    const insertedId = rows[0]?.id;
    if (!insertedId) return null;

    if (extension && raw.sourceKind === "telegram") {
      await this.telegramExt.insertInTransaction(manager, {
        rawMessageId: insertedId,
        chatId: extension.chatId,
        messageId: extension.messageId,
        editDate: extension.editDate,
        peerType: extension.peerType,
      });
    }
    return insertedId;
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
