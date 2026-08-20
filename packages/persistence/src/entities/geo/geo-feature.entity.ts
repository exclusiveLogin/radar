/**
 * @see ../../../../../docs/database-table-naming.md
 * Структурная геометрия OSM: контуры субъектов, районов, городов, ФО.
 * Создаётся при geo:features:import — не в runtime parse.
 * @see docs/rfc/adr-005-geo-feature.md
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { RegionEntity } from "./region.entity";

export type GeoFeatureLayer = "subject" | "district" | "city" | "city_district" | "federal_district";

@Entity({ name: "geo_feature" })
@Index("idx_geo_feature_region_layer_stem", ["regionId", "layer", "nameStem"])
export class GeoFeatureEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** Уровень иерархии: субъект, район субъекта, город, район города, ФО. */
  @Column({ name: "layer", type: "text" })
  layer!: GeoFeatureLayer;

  @Column({ name: "region_id", type: "uuid", nullable: true })
  regionId!: string | null;

  @ManyToOne(() => RegionEntity, { onDelete: "RESTRICT", nullable: true })
  @JoinColumn({ name: "region_id" })
  region!: RegionEntity | null;

  @Column({ name: "name", type: "text" })
  name!: string;

  @Column({ name: "name_stem", type: "text", default: "" })
  nameStem!: string;

  @Column({ name: "geometry", type: "jsonb", nullable: true })
  geometry!: Record<string, unknown> | null;

  @Column({ name: "bbox", type: "jsonb", nullable: true })
  bbox!: [number, number, number, number] | null;

  @Column({ name: "centroid_lat", type: "numeric", precision: 9, scale: 6, nullable: true })
  centroidLat!: string | null;

  @Column({ name: "centroid_lon", type: "numeric", precision: 9, scale: 6, nullable: true })
  centroidLon!: string | null;

  @Column({ name: "fias_id", type: "text", nullable: true, unique: true })
  fiasId!: string | null;

  @Column({ name: "kladr_id", type: "text", nullable: true })
  kladrId!: string | null;

  @Column({ name: "oktmo", type: "text", nullable: true })
  oktmo!: string | null;

  @Column({ name: "source_file_key", type: "text", nullable: true })
  sourceFileKey!: string | null;

  @Column({ name: "source_meta", type: "jsonb", default: () => "'{}'::jsonb" })
  sourceMeta!: Record<string, unknown>;

  @Column({ name: "is_active", type: "boolean", default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
