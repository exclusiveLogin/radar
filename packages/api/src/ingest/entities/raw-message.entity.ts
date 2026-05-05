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

  @Column({ name: "telegram_message_id", type: "bigint" })
  telegramMessageId!: string;

  @Column({ name: "hash", type: "text", unique: true })
  hash!: string;

  @Column({ name: "posted_at", type: "timestamptz" })
  postedAt!: Date;

  @Column({ name: "raw_text", type: "text" })
  rawText!: string;

  @Column({ name: "raw_payload", type: "jsonb", default: () => "'{}'::jsonb" })
  rawPayload!: Record<string, unknown>;

  @Column({ name: "edit_date", type: "timestamptz", nullable: true })
  editDate!: Date | null;

  @Column({ name: "fetched_at", type: "timestamptz", default: () => "now()" })
  fetchedAt!: Date;
}
