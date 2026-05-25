import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { ChannelEntity } from "./channel.entity";

@Entity({ name: "ingest_cursors" })
export class IngestCursorEntity {
  @PrimaryColumn({ name: "channel_id", type: "uuid" })
  channelId!: string;

  @PrimaryColumn({ name: "provider_key", type: "text" })
  providerKey!: string;

  @ManyToOne(() => ChannelEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "channel_id" })
  channel!: ChannelEntity;

  @Column({ name: "live_last_external_id", type: "text", nullable: true })
  liveLastExternalId!: string | null;

  @Column({ name: "live_last_posted_at", type: "timestamptz", nullable: true })
  liveLastPostedAt!: Date | null;

  @Column({ name: "live_last_source_sequence", type: "text", nullable: true })
  liveLastSourceSequence!: string | null;

  @Column({ name: "backfill_state", type: "jsonb", default: () => "'{}'::jsonb" })
  backfillState!: Record<string, unknown>;

  @Column({ name: "external_cursor", type: "jsonb", default: () => "'{}'::jsonb" })
  externalCursor!: Record<string, unknown>;

  @Column({ name: "updated_at", type: "timestamptz", default: () => "now()" })
  updatedAt!: Date;
}
