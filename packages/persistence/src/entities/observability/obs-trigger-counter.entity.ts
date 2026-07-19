import { Column, Entity, PrimaryColumn } from "typeorm";

/** Счётчик триггеров: pipeline × event_type × source. */
@Entity({ name: "obs_trigger_counters" })
export class ObsTriggerCounterEntity {
  @PrimaryColumn({ name: "pipeline_key", type: "text" })
  pipelineKey!: string;

  @PrimaryColumn({ name: "event_type", type: "text" })
  eventType!: string;

  @PrimaryColumn({ name: "source", type: "text" })
  source!: string;

  @Column({ name: "count", type: "bigint", default: 0 })
  count!: string;
}
