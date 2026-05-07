/**
 * ---
 * layer: api
 * kind: entity
 * table: event_locations
 * purpose: Связь parsed_event с регионом/местом и точностью геопривязки.
 * ---
 */
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { PlaceEntity } from "../../geo/entities";
import { RegionEntity } from "../../geo/entities";
import { ParsedEventEntity } from "./parsed-event.entity";

@Entity({ name: "event_locations" })
export class EventLocationEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "parsed_event_id", type: "uuid" })
  parsedEventId!: string;

  @ManyToOne(() => ParsedEventEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "parsed_event_id" })
  parsedEvent!: ParsedEventEntity;

  @Column({ name: "region_id", type: "uuid" })
  regionId!: string;

  @ManyToOne(() => RegionEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "region_id" })
  region!: RegionEntity;

  @Column({ name: "place_id", type: "uuid", nullable: true })
  placeId!: string | null;

  @ManyToOne(() => PlaceEntity, { onDelete: "RESTRICT", nullable: true })
  @JoinColumn({ name: "place_id" })
  place!: PlaceEntity | null;

  @Column({ name: "precision", type: "text" })
  precision!: "region" | "district" | "city" | "locality" | "settlement";

  @Column({ name: "lat", type: "numeric", precision: 9, scale: 6, nullable: true })
  lat!: string | null;

  @Column({ name: "lon", type: "numeric", precision: 9, scale: 6, nullable: true })
  lon!: string | null;

  @Column({ name: "source", type: "text" })
  source!: "db" | "dadata" | "nominatim" | "llm" | "cache";
}
