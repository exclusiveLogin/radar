/**
 * ---
 * layer: api
 * kind: entity
 * table: domain_events
 * purpose: Outbox-персистенс доменных событий для relay и внешних подписчиков.
 * ---
 */
import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "domain_events" })
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
