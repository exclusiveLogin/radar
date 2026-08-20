/**
 * @see ../../../../../docs/database-table-naming.md
 * ---
 * layer: api
 * kind: entity
 * table: state_event_subscription
 * purpose: Состояние внешнего потребителя событий (бот, webhook): до какого offset дочитал, чтобы не слать повторно при сбое.
 * @see ../../../../../docs/domain/persistence-map.md#EventSubscriptionEntity
 * ---
 */
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity({ name: "state_event_subscription" })
export class EventSubscriptionEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "name", type: "text", unique: true })
  name!: string;

  @Column({ name: "event_types", type: "text", array: true, default: () => "ARRAY[]::text[]" })
  eventTypes!: string[];

  @Column({ name: "last_event_id", type: "uuid", nullable: true })
  lastEventId!: string | null;

  @Column({ name: "last_processed_at", type: "timestamptz", nullable: true })
  lastProcessedAt!: Date | null;

  @Column({ name: "status", type: "text", default: "active" })
  status!: "active" | "paused" | "error";

  @Column({ name: "error_message", type: "text", nullable: true })
  errorMessage!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
