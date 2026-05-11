import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { PlaceAliasEntity } from "./place-alias.entity";
import { RegionEntity } from "./region.entity";

export type PlaceKind = "district" | "city" | "locality" | "settlement" | "urban_okrug" | "mo_go";
export type PlaceTrustState = "unverified" | "partially_verified" | "verified" | "rejected";

@Entity({ name: "places" })
export class PlaceEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "region_id", type: "uuid" })
  regionId!: string;

  @ManyToOne(() => RegionEntity, (region) => region.places, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "region_id" })
  region!: RegionEntity;

  @Column({ name: "parent_place_id", type: "uuid", nullable: true })
  parentPlaceId!: string | null;

  @ManyToOne(() => PlaceEntity, (place) => place.children, { onDelete: "RESTRICT", nullable: true })
  @JoinColumn({ name: "parent_place_id" })
  parentPlace!: PlaceEntity | null;

  @OneToMany(() => PlaceEntity, (place) => place.parentPlace)
  children!: PlaceEntity[];

  @Column({
    name: "kind",
    type: "text",
  })
  kind!: PlaceKind;

  @Column({ name: "name", type: "text" })
  name!: string;

  @Column({ name: "name_with_type", type: "text", nullable: true })
  nameWithType!: string | null;

  @Column({ name: "name_normalized", type: "text", default: "" })
  nameNormalized!: string;

  @Column({ name: "fias_id", type: "text", nullable: true, unique: true })
  fiasId!: string | null;

  @Column({ name: "kladr_id", type: "text", nullable: true })
  kladrId!: string | null;

  @Column({ name: "oktmo", type: "text", nullable: true })
  oktmo!: string | null;

  @Column({ name: "centroid_lat", type: "numeric", precision: 9, scale: 6, nullable: true })
  centroidLat!: string | null;

  @Column({ name: "centroid_lon", type: "numeric", precision: 9, scale: 6, nullable: true })
  centroidLon!: string | null;

  @Column({ name: "bbox", type: "jsonb", nullable: true })
  bbox!: Record<string, unknown> | null;

  @Column({ name: "geometry_artifact_key", type: "text", nullable: true })
  geometryArtifactKey!: string | null;

  @Column({ name: "is_active", type: "boolean", default: true })
  isActive!: boolean;

  @Column({ name: "deprecated_at", type: "timestamptz", nullable: true })
  deprecatedAt!: Date | null;

  @Column({ name: "last_synced_at", type: "timestamptz", nullable: true })
  lastSyncedAt!: Date | null;

  @Column({ name: "last_source_revision", type: "text", nullable: true })
  lastSourceRevision!: string | null;

  @Column({ name: "trust_state", type: "text", default: "unverified" })
  trustState!: PlaceTrustState;

  @Column({ name: "is_trusted", type: "boolean", default: false })
  isTrusted!: boolean;

  @Column({ name: "trust_score", type: "numeric", precision: 4, scale: 3, nullable: true })
  trustScore!: string | null;

  @Column({ name: "trust_updated_at", type: "timestamptz", nullable: true })
  trustUpdatedAt!: Date | null;

  @Column({ name: "evidence_providers", type: "jsonb", default: () => "'[]'::jsonb" })
  evidenceProviders!: string[];

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @OneToMany(() => PlaceAliasEntity, (alias) => alias.place)
  aliases!: PlaceAliasEntity[];
}
