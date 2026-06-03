/**
 * Связь place(kind=region) ↔ geo_feature(layer=subject).
 * Создаётся при geo:features:import для субъектов.
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import { GeoFeatureEntity } from "./geo-feature.entity";
import { PlaceEntity } from "./place.entity";

@Entity({ name: "place_geo_link" })
@Unique("uq_place_geo_link_place_feature", ["placeId", "geoFeatureId"])
export class PlaceGeoLinkEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "place_id", type: "uuid" })
  placeId!: string;

  @ManyToOne(() => PlaceEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "place_id" })
  place!: PlaceEntity;

  @Column({ name: "geo_feature_id", type: "uuid" })
  geoFeatureId!: string;

  @ManyToOne(() => GeoFeatureEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "geo_feature_id" })
  geoFeature!: GeoFeatureEntity;

  /** boundary — основная роль; резервный слот для доп. типов. */
  @Column({ name: "role", type: "text", default: "boundary" })
  role!: string;

  /** 0 = Russia_regions (основные), выше = supplemental (front-regions). */
  @Column({ name: "priority", type: "integer", default: 0 })
  priority!: number;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
