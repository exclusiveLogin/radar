/**
 * Дополнительный ключ дедупликации для MTProto: одно логическое сообщение Telegram = одна строка raw.
 * Нужен потому что identity в `raw_messages` не всегда совпадает с парой chat/message при правках и re-ingest.
 * @see ../../../../../docs/domain/persistence-map.md#RawMessageTelegramEntity
 * @see ../../../../../docs/domain/contexts/ingest.md
 */
import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from "typeorm";
import { RawMessageEntity } from "./raw-message.entity";

@Entity({ name: "raw_message_telegram" })
export class RawMessageTelegramEntity {
  @PrimaryColumn({ name: "raw_message_id", type: "uuid" })
  rawMessageId!: string;

  @OneToOne(() => RawMessageEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "raw_message_id" })
  rawMessage!: RawMessageEntity;

  @Column({ name: "chat_id", type: "bigint" })
  chatId!: string;

  @Column({ name: "message_id", type: "bigint" })
  messageId!: string;

  @Column({ name: "edit_date", type: "timestamptz", nullable: true })
  editDate!: Date | null;

  @Column({ name: "peer_type", type: "text", nullable: true })
  peerType!: string | null;
}
