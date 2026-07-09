/**
 * ---
 * layer: api
 * kind: entity
 * table: mat_parse_location
 * purpose: Где на карте показать событие: ссылка на region/place + координаты/точность; один parsed_event может иметь несколько кандидатов локации.
 * @see ../../../../../docs/domain/persistence-map.md#EventLocationEntity
 * @see ../../../../../docs/database-table-naming.md`n * @see ../../../../../docs/domain/how-it-works.md#parse-flow
 * ---
 */
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { PlaceEntity } from "../../geo/entities";
import { RegionEntity } from "../../geo/entities";
import { ParsedEventEntity } from "./parsed-event.entity";

@Entity({ name: "mat_parse_location" })
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
  precision!: "region" | "district" | "city" | "locality" | "settlement" | "vicinity";

  @Column({ name: "lat", type: "numeric", precision: 9, scale: 6, nullable: true })
  lat!: string | null;

  @Column({ name: "lon", type: "numeric", precision: 9, scale: 6, nullable: true })
  lon!: string | null;

  @Column({ name: "source", type: "text" })
  source!: "db" | "dadata" | "nominatim" | "llm" | "cache";

  @Column({ name: "entity_kind", type: "text", default: "region" })
  entityKind!: "region" | "place" | "point";

  @Column({ name: "confidence", type: "numeric", precision: 4, scale: 3, nullable: true })
  confidence!: string | null;

  @Column({ name: "author_channel_key", type: "text", nullable: true })
  authorChannelKey!: string | null;

  @Column({ name: "action", type: "text", default: "raise" })
  action!: "raise" | "clear";

  @Column({ name: "status_code", type: "text", nullable: true })
  statusCode!: string | null;

  @Column({ name: "occurred_at", type: "timestamptz", default: () => "now()" })
  occurredAt!: Date;

  @Column({ name: "scope_radius_m", type: "numeric", precision: 10, scale: 2, nullable: true })
  scopeRadiusM!: string | null;
}
