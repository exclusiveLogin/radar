/**
 * ---
 * layer: api
 * kind: entity
 * table: parsed_events
 * purpose: Основной write-side результат классификации/парсинга сообщений.
 * ---
 */
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { RawMessageEntity } from "../../ingest/entities/raw-message.entity";

@Entity({ name: "parsed_events" })
export class ParsedEventEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "raw_message_id", type: "uuid" })
  rawMessageId!: string;

  @ManyToOne(() => RawMessageEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "raw_message_id" })
  rawMessage!: RawMessageEntity;

  @Column({ name: "event_type", type: "text" })
  eventType!: string;

  @Column({ name: "severity", type: "text" })
  severity!: string;

  @Column({ name: "repeat", type: "boolean", default: false })
  repeat!: boolean;

  @Column({ name: "count", type: "integer", nullable: true })
  count!: number | null;

  @Column({ name: "direction", type: "text", nullable: true })
  direction!: string | null;

  @Column({ name: "macro_zone", type: "text", nullable: true })
  macroZone!: "rear" | "front" | "border" | null;

  @Column({ name: "parser_version", type: "text" })
  parserVersion!: string;

  @Column({ name: "confidence", type: "numeric", precision: 3, scale: 2, default: "1.00" })
  confidence!: string;

  @Column({ name: "extras", type: "jsonb", default: () => "'{}'::jsonb" })
  extras!: Record<string, unknown>;

  @Column({ name: "parsed_at", type: "timestamptz", default: () => "now()" })
  parsedAt!: Date;
}
