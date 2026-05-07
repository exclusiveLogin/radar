import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { PlaceEntity } from "../../geo/entities";
import { StatusDictionaryEntity } from "./status-dictionary.entity";

@Entity({ name: "place_status_active" })
export class PlaceStatusActiveEntity {
  @PrimaryColumn({ name: "place_id", type: "uuid" })
  placeId!: string;

  @ManyToOne(() => PlaceEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "place_id" })
  place!: PlaceEntity;

  @PrimaryColumn({ name: "status_code", type: "text" })
  statusCode!: string;

  @ManyToOne(() => StatusDictionaryEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "status_code", referencedColumnName: "code" })
  status!: StatusDictionaryEntity;

  @Column({ name: "source", type: "text" })
  source!: "parser" | "operator" | "system";

  @Column({ name: "started_at", type: "timestamptz" })
  startedAt!: Date;

  @Column({ name: "updated_at", type: "timestamptz", default: () => "now()" })
  updatedAt!: Date;

  @Column({ name: "meta", type: "jsonb", default: () => "'{}'::jsonb" })
  meta!: Record<string, unknown>;
}
