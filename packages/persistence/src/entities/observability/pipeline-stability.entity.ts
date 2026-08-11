import { Column, Entity, PrimaryColumn } from "typeorm";

/** Persisted claim busy→stabilized для cascade между репликами одной роли. */
@Entity({ name: "state_pipeline_stability" })
export class PipelineStabilityEntity {
  @PrimaryColumn({ name: "scope_key", type: "text" })
  scopeKey!: string;

  @Column({ name: "status", type: "text" })
  status!: "busy" | "stabilized";

  @Column({ name: "generation", type: "int", default: 0 })
  generation!: number;

  @Column({ name: "updated_at", type: "timestamptz", default: () => "now()" })
  updatedAt!: Date;
}
