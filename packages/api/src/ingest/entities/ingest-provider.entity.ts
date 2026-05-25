import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { IngestBindingEntity } from "./ingest-binding.entity";

@Entity({ name: "ingest_providers" })
export class IngestProviderEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "text", unique: true })
  key!: string;

  @Column({ type: "text" })
  title!: string;

  @Column({ name: "adapter_kind", type: "text" })
  adapterKind!: string;

  @Column({ type: "text", default: "draft" })
  status!: string;

  @Column({ name: "adapter_config", type: "jsonb", default: () => "'{}'::jsonb" })
  adapterConfig!: Record<string, unknown>;

  @Column({ name: "credential_refs", type: "jsonb", default: () => "'{}'::jsonb" })
  credentialRefs!: Record<string, unknown>;

  @Column({ name: "last_error", type: "text", nullable: true })
  lastError!: string | null;

  @Column({ name: "last_heartbeat_at", type: "timestamptz", nullable: true })
  lastHeartbeatAt!: Date | null;

  @OneToMany(() => IngestBindingEntity, (b) => b.provider)
  bindings!: IngestBindingEntity[];

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
