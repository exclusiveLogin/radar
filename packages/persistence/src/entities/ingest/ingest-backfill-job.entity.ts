/**
 * Слот докачки истории (диапазон дат/id): 1 binding = 1 row (UNIQUE).
 * Сообщения — в `mat_ingest_raw` (ingest_mode=backfill); здесь только текущая операция, не история запусков.
 * @see ../../../../../docs/domain/persistence-map.md#IngestBackfillJobEntity
 * @see ../../../../../docs/database-table-naming.md
 * @see ../../../../../docs/domain/contexts/ingest.md
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { IngestBindingEntity } from "./ingest-binding.entity";
import { IngestProviderEntity } from "./ingest-provider.entity";

/** Учёт операции докачки: один слот на binding (UNIQUE), не лог истории. */
@Entity({ name: "job_ingest_backfill" })
export class IngestBackfillJobEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index("uq_job_ingest_backfill_binding_id", { unique: true })
  @Column({ name: "binding_id", type: "uuid" })
  bindingId!: string;

  @ManyToOne(() => IngestBindingEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "binding_id" })
  binding!: IngestBindingEntity;

  @Column({ name: "provider_id", type: "uuid" })
  providerId!: string;

  @ManyToOne(() => IngestProviderEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "provider_id" })
  provider!: IngestProviderEntity;

  @Column({ type: "text" })
  strategy!: string;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  params!: Record<string, unknown>;

  @Column({ type: "text", default: "pending" })
  status!: string;

  @Column({ type: "jsonb", default: () => "'{\"inserted\":0,\"duplicates\":0,\"parsed\":0}'::jsonb" })
  stats!: { inserted: number; duplicates: number; parsed: number };

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
