import { Column, Entity, PrimaryColumn } from "typeorm";

/** Worker/process host — role, ODP badge, heartbeat. @see docs/database-table-naming.md */
@Entity({ name: "obs_hosts" })
export class ObsHostEntity {
  @PrimaryColumn({ name: "host_id", type: "text" })
  hostId!: string;

  @Column({ name: "role", type: "text" })
  role!: string;

  @Column({ name: "started_at", type: "timestamptz" })
  startedAt!: Date;

  @Column({ name: "last_seen_at", type: "timestamptz" })
  lastSeenAt!: Date;

  @Column({ name: "odp_runtime", type: "jsonb", default: () => "'[]'::jsonb" })
  odpRuntime!: Record<string, unknown>[];

  @Column({ name: "metrics", type: "jsonb", nullable: true })
  metrics!: Record<string, unknown> | null;
}
