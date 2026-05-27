/**
 * Технический след parse (успех/отказ, версия парсера) для отладки и метрик — не показывается на карте.
 * Нужен отдельно от `parsed_events`, потому что большинство raw так и остаётся «не событием» без бизнес-записи.
 * @see ../../../../../docs/domain/persistence-map.md#ParseAttemptEntity
 * @see ../../../../../docs/domain/how-it-works.md#parse-flow
 */
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { RawMessageEntity } from "../../ingest/entities";

@Entity({ name: "parse_attempts" })
export class ParseAttemptEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "raw_message_id", type: "uuid" })
  rawMessageId!: string;

  @ManyToOne(() => RawMessageEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "raw_message_id" })
  rawMessage!: RawMessageEntity;

  @Column({ name: "parser_version", type: "text" })
  parserVersion!: string;

  @Column({ name: "status", type: "text" })
  status!: "ok" | "failed" | "skipped";

  @Column({ name: "errors", type: "jsonb", nullable: true })
  errors!: Record<string, unknown> | null;

  @Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
  createdAt!: Date;
}
