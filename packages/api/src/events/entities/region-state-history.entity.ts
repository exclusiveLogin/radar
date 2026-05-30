/**
 * История смен операционного состояния региона (для таймлайна/аудита).
 */
import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

type StateLevel = "grey" | "green" | "yellow" | "orange" | "red";

@Entity({ name: "region_state_history" })
export class RegionStateHistoryEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "region_id", type: "uuid" })
  regionId!: string;

  @Column({ name: "region_code", type: "text" })
  regionCode!: string;

  @Column({ name: "state_level", type: "text" })
  stateLevel!: StateLevel;

  @Column({ name: "previous_level", type: "text" })
  previousLevel!: StateLevel;

  @Column({ name: "reason", type: "text", nullable: true })
  reason!: string | null;

  @Column({ name: "changed_at", type: "timestamptz" })
  changedAt!: Date;
}
