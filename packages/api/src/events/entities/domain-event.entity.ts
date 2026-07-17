/**
 * ---
 * layer: api
 * kind: entity
 * table: event_outbox
 * purpose: Журнал «что произошло» для интеграций: API пишет сюда, OutboxRelay доставляет в bus; не заменяет таблицы состояния (raw/parsed).
 * @see ../../../../../docs/domain/persistence-map.md#DomainEventEntity
 * @see ../../../../../docs/database-table-naming.md
 * @see ../../../../../docs/domain/domain-events-and-outbox.md
 * ---
 */
import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "event_outbox" })
export class DomainEventEntity {
  @PrimaryColumn({ name: "id", type: "uuid" })
  id!: string;

  @Column({ name: "type", type: "text" })
  type!: string;

  @Column({ name: "version", type: "integer", default: 1 })
  version!: number;

  @Column({ name: "aggregate_type", type: "text" })
  aggregateType!: string;

  @Column({ name: "aggregate_id", type: "text", nullable: true })
  aggregateId!: string | null;

  @Column({ name: "payload", type: "jsonb" })
  payload!: Record<string, unknown>;

  @Column({ name: "occurred_at", type: "timestamptz" })
  occurredAt!: Date;

  @Column({ name: "published_at", type: "timestamptz", nullable: true })
  publishedAt!: Date | null;

  @Column({ name: "trace_id", type: "text", nullable: true })
  traceId!: string | null;
}
