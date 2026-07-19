import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { ObsHostEntity } from "./obs-host.entity";

/** Workload mill (parse/tracking/geo-enrich) на хосте. */
@Entity({ name: "obs_workloads" })
export class ObsWorkloadEntity {
  @PrimaryColumn({ name: "workload_id", type: "text" })
  workloadId!: string;

  @Column({ name: "host_id", type: "text" })
  hostId!: string;

  @ManyToOne(() => ObsHostEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "host_id" })
  host!: ObsHostEntity;

  @Column({ name: "pipeline_key", type: "text" })
  pipelineKey!: string;

  @Column({ name: "runtime", type: "text" })
  runtime!: "legacy" | "runner-platform";

  @Column({ name: "status", type: "text" })
  status!: string;

  @Column({ name: "last_tick_at", type: "timestamptz", nullable: true })
  lastTickAt!: Date | null;

  @Column({ name: "metrics", type: "jsonb", nullable: true })
  metrics!: Record<string, unknown> | null;
}
