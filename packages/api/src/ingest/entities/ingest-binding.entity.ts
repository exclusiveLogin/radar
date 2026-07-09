/**
 * Какой канал слушает конкретный провайдер и в каком режиме (live MTProto, bot, backfill-only).
 * Отдельно от provider: один провайдер может иметь несколько bindings; backfill-статистика — события на `ingest_binding`.
 * @see ../../../../../docs/domain/persistence-map.md#IngestBindingEntity
 * @see ../../../../../docs/database-table-naming.md`n * @see ../../../../../docs/domain/contexts/ingest.md
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { ChannelEntity } from "./channel.entity";
import { IngestProviderEntity } from "./ingest-provider.entity";

@Entity({ name: "ingest_bindings" })
export class IngestBindingEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "provider_id", type: "uuid" })
  providerId!: string;

  @ManyToOne(() => IngestProviderEntity, (p) => p.bindings, { onDelete: "CASCADE" })
  @JoinColumn({ name: "provider_id" })
  provider!: IngestProviderEntity;

  @Column({ name: "channel_id", type: "uuid", nullable: true })
  channelId!: string | null;

  @ManyToOne(() => ChannelEntity, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "channel_id" })
  channel!: ChannelEntity | null;

  @Column({ name: "binding_key", type: "text" })
  bindingKey!: string;

  @Column({ type: "boolean", default: true })
  enabled!: boolean;

  @Column({ name: "external_target", type: "text" })
  externalTarget!: string;

  @Column({ name: "binding_mode", type: "text" })
  bindingMode!: string;

  @Column({ name: "parse_overrides", type: "jsonb", default: () => "'{}'::jsonb" })
  parseOverrides!: Record<string, unknown>;

  @Column({ name: "adapter_binding", type: "jsonb", default: () => "'{}'::jsonb" })
  adapterBinding!: Record<string, unknown>;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
