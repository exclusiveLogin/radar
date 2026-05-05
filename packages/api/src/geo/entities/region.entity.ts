import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { PlaceEntity } from "./place.entity";

@Entity({ name: "regions" })
export class RegionEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "fias_id", type: "text", nullable: true, unique: true })
  fiasId!: string | null;

  @Column({ name: "kladr_id", type: "text", nullable: true })
  kladrId!: string | null;

  @Column({ name: "iso", type: "text", nullable: true })
  iso!: string | null;

  @Column({ name: "name", type: "text" })
  name!: string;

  @Column({ name: "name_with_type", type: "text", nullable: true })
  nameWithType!: string | null;

  @Column({ name: "short_name", type: "text", nullable: true })
  shortName!: string | null;

  @Column({ name: "federal_district", type: "text", nullable: true })
  federalDistrict!: string | null;

  @Column({ name: "front_region", type: "boolean", default: false })
  frontRegion!: boolean;

  @Column({ name: "border_region", type: "boolean", default: false })
  borderRegion!: boolean;

  @Column({ name: "centroid_lat", type: "numeric", precision: 9, scale: 6, nullable: true })
  centroidLat!: string | null;

  @Column({ name: "centroid_lon", type: "numeric", precision: 9, scale: 6, nullable: true })
  centroidLon!: string | null;

  @Column({ name: "bbox", type: "jsonb", nullable: true })
  bbox!: Record<string, unknown> | null;

  @Column({ name: "geometry_artifact_key", type: "text", nullable: true })
  geometryArtifactKey!: string | null;

  @Column({ name: "source_meta", type: "jsonb", default: () => "'{}'::jsonb" })
  sourceMeta!: Record<string, unknown>;

  @Column({ name: "is_active", type: "boolean", default: true })
  isActive!: boolean;

  @Column({ name: "deprecated_at", type: "timestamptz", nullable: true })
  deprecatedAt!: Date | null;

  @Column({ name: "last_synced_at", type: "timestamptz", nullable: true })
  lastSyncedAt!: Date | null;

  @Column({ name: "last_source_revision", type: "text", nullable: true })
  lastSourceRevision!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @OneToMany(() => PlaceEntity, (place) => place.region)
  places!: PlaceEntity[];
}
