import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { PlaceEntity } from "../../geo/entities";
import { StatusDictionaryEntity } from "./status-dictionary.entity";

@Entity({ name: "place_status_history" })
export class PlaceStatusHistoryEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "place_id", type: "uuid" })
  placeId!: string;

  @ManyToOne(() => PlaceEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "place_id" })
  place!: PlaceEntity;

  @Column({ name: "status_code", type: "text" })
  statusCode!: string;

  @ManyToOne(() => StatusDictionaryEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "status_code", referencedColumnName: "code" })
  status!: StatusDictionaryEntity;

  @Column({ name: "action", type: "text" })
  action!: "activate" | "deactivate";

  @Column({ name: "source", type: "text" })
  source!: "parser" | "operator" | "system";

  @Column({ name: "event_at", type: "timestamptz" })
  eventAt!: Date;

  @Column({ name: "meta", type: "jsonb", default: () => "'{}'::jsonb" })
  meta!: Record<string, unknown>;
}
