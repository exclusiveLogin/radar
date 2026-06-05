/**
 * ---
 * layer: api
 * kind: entity
 * table: parsed_events
 * purpose: Структурированное оповещение для карты/ленты после parse (тип угрозы, severity) — 1:1 с успешным разбором raw; не дублирует сырой текст.
 * @see ../../../../../docs/domain/persistence-map.md#ParsedEventEntity
 * @see ../../../../../docs/domain/how-it-works.md#parse-flow
 * @see ../../../../../docs/domain/aggregates.md
 * ---
 */
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { RawMessageEntity } from "../../ingest/entities";

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

  @Column({ name: "is_active", type: "boolean", default: true })
  isActive!: boolean;

  @Column({ name: "inactive_reason", type: "text", nullable: true })
  inactiveReason!: string | null;

  /** Субъект угрозы: drone | rocket | mws | aviation | other. */
  @Column({ name: "event_subject", type: "text", nullable: true })
  eventSubject!: string | null;
}
