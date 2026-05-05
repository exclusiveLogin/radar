import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity({ name: "geo_sync_log" })
export class GeoSyncLogEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "target", type: "text" })
  target!: "regions" | "places" | "aliases" | "all";

  @Column({ name: "source_id", type: "text", nullable: true })
  sourceId!: string | null;

  @Column({ name: "source_revision", type: "text", nullable: true })
  sourceRevision!: string | null;

  @CreateDateColumn({ name: "started_at", type: "timestamptz" })
  startedAt!: Date;

  @Column({ name: "finished_at", type: "timestamptz", nullable: true })
  finishedAt!: Date | null;

  @Column({ name: "status", type: "text", default: "running" })
  status!: "running" | "ok" | "failed" | "aborted";

  @Column({ name: "counts", type: "jsonb", default: () => "'{}'::jsonb" })
  counts!: Record<string, unknown>;

  @Column({ name: "diff_sample", type: "jsonb", nullable: true })
  diffSample!: Record<string, unknown> | null;

  @Column({ name: "errors", type: "jsonb", nullable: true })
  errors!: Record<string, unknown> | null;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
