/**
 * Текущее операционное состояние региона для карты (проекция, один срез на регион).
 * `state_level` — эффективный уровень (с учётом соседей), `self_level` — собственный
 * уровень региона по его событиям (база для пересчёта propagation без обратной связи).
 */
import { Column, Entity, PrimaryColumn } from "typeorm";

type StateLevel = "grey" | "green" | "yellow" | "orange" | "red";

@Entity({ name: "region_state_active" })
export class RegionStateActiveEntity {
  @PrimaryColumn({ name: "region_id", type: "uuid" })
  regionId!: string;

  @Column({ name: "region_code", type: "text" })
  regionCode!: string;

  @Column({ name: "state_level", type: "text", default: "grey" })
  stateLevel!: StateLevel;

  @Column({ name: "self_level", type: "text", default: "grey" })
  selfLevel!: StateLevel;

  @Column({ name: "activity", type: "integer", default: 0 })
  activity!: number;

  @Column({ name: "reason", type: "text", nullable: true })
  reason!: string | null;

  @Column({ name: "updated_at", type: "timestamptz", default: () => "now()" })
  updatedAt!: Date;

  /** postedAt raw-сообщения, установившего текущий операционный срез. */
  @Column({ name: "status_event_at", type: "timestamptz", nullable: true })
  statusEventAt!: Date | null;
}
