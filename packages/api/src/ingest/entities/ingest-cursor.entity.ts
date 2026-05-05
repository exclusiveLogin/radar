import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from "typeorm";
import { ChannelEntity } from "./channel.entity";

@Entity({ name: "ingest_cursors" })
export class IngestCursorEntity {
  @PrimaryColumn({ name: "channel_id", type: "uuid" })
  channelId!: string;

  @OneToOne(() => ChannelEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "channel_id" })
  channel!: ChannelEntity;

  @Column({ name: "last_message_id", type: "bigint", nullable: true })
  lastMessageId!: string | null;

  @Column({ name: "last_posted_at", type: "timestamptz", nullable: true })
  lastPostedAt!: Date | null;

  @Column({ name: "updated_at", type: "timestamptz", default: () => "now()" })
  updatedAt!: Date;
}
