import { Column, Entity, PrimaryColumn } from "typeorm";

/** Счётчик materialize per pipelineKey. */
@Entity({ name: "obs_materialize_counters" })
export class ObsMaterializeCounterEntity {
  @PrimaryColumn({ name: "pipeline_key", type: "text" })
  pipelineKey!: string;

  @Column({ name: "count", type: "bigint", default: 0 })
  count!: string;

  @Column({ name: "updated_at", type: "timestamptz", default: () => "now()" })
  updatedAt!: Date;
}
