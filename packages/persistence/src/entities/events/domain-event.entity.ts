/**
 * ---
 * layer: api
 * kind: entity
 * table: event_outbox
 * purpose: Dormant audit/journal (geo-sync append). Not hot-path transport — RMQ publishConfirmed owns delivery.
 * Future option: flag-gated transfer/fallback beside or instead of RMQ with dedup.
 * @see ../../../../../docs/architecture/domain-inventory.md
 * @see ../../../../../docs/domain/persistence-map.md#DomainEventEntity
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
