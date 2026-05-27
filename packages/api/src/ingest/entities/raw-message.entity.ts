/**
 * Неизменяемый снимок текста из канала до парсинга — источник правды для dedup и повторного parse.
 * Повторная доставка не перезаписывает строку: только duplicate-событие; id строки = `aggregateId` потока `raw_message`.
 * Доменный контракт use case: `RawMessage` в @radar/shared (не путать с content hash).
 * @see ../../../../../docs/domain/persistence-map.md#RawMessageEntity
 * @see ../../../../../docs/domain/how-it-works.md#ingest-flow
 * @see ../../../../../docs/domain/aggregates.md
 */
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { ChannelEntity } from "./channel.entity";

@Entity({ name: "raw_messages" })
export class RawMessageEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "channel_id", type: "uuid" })
  channelId!: string;

  @ManyToOne(() => ChannelEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "channel_id" })
  channel!: ChannelEntity;

  @Column({ name: "provider_key", type: "text" })
  providerKey!: string;

  @Column({ name: "source_kind", type: "text" })
  sourceKind!: string;

  @Column({ name: "external_message_id", type: "text" })
  externalMessageId!: string;

  @Column({ name: "revision_key", type: "text", nullable: true })
  revisionKey!: string | null;

  @Column({ name: "source_sequence", type: "text", nullable: true })
  sourceSequence!: string | null;

  @Column({ name: "ingest_mode", type: "text", default: "live" })
  ingestMode!: string;

  @Column({ name: "hash", type: "text", unique: true })
  hash!: string;

  @Column({ name: "posted_at", type: "timestamptz" })
  postedAt!: Date;

  @Column({ name: "raw_text", type: "text" })
  rawText!: string;

  @Column({ name: "raw_payload", type: "jsonb", default: () => "'{}'::jsonb" })
  rawPayload!: Record<string, unknown>;

  @Column({ name: "fetched_at", type: "timestamptz", default: () => "now()" })
  fetchedAt!: Date;
}
