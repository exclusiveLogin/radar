import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { ObsHostEntity } from "./obs-host.entity";

/** Process/thread executor на хосте. */
@Entity({ name: "obs_executors" })
export class ObsExecutorEntity {
  @PrimaryColumn({ name: "executor_id", type: "text" })
  executorId!: string;

  @Column({ name: "host_id", type: "text" })
  hostId!: string;

  @ManyToOne(() => ObsHostEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "host_id" })
  host!: ObsHostEntity;

  @Column({ name: "kind", type: "text" })
  kind!: "process" | "thread" | "external";

  @Column({ name: "parent_id", type: "text", nullable: true })
  parentId!: string | null;

  @Column({ name: "last_seen_at", type: "timestamptz" })
  lastSeenAt!: Date;

  @Column({ name: "status", type: "text" })
  status!: string;

  @Column({ name: "metrics", type: "jsonb", nullable: true })
  metrics!: Record<string, unknown> | null;
}
