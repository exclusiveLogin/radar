/**
 * Альтернативные написания («Белгород», «г. Белгород») → один region или place при разборе текста канала.
 * Снижает дубли places и ошибки LLM: матч по нормализованной строке до вызова внешних enricher.
 * @see ../../../../../docs/domain/persistence-map.md#PlaceAliasEntity
 * @see ../../../../../docs/database-table-naming.md`n * @see ../../../../../docs/domain/contexts/geo-place.md
 */
import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { PlaceEntity } from "./place.entity";
import { RegionEntity } from "./region.entity";

@Entity({ name: "place_aliases" })
export class PlaceAliasEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "target_kind", type: "text" })
  targetKind!: "region" | "place";

  @Column({ name: "region_id", type: "uuid", nullable: true })
  regionId!: string | null;

  @ManyToOne(() => RegionEntity, { onDelete: "RESTRICT", nullable: true })
  @JoinColumn({ name: "region_id" })
  region!: RegionEntity | null;

  @Column({ name: "place_id", type: "uuid", nullable: true })
  placeId!: string | null;

  @ManyToOne(() => PlaceEntity, (place) => place.aliases, { onDelete: "RESTRICT", nullable: true })
  @JoinColumn({ name: "place_id" })
  place!: PlaceEntity | null;

  @Column({ name: "alias", type: "text" })
  alias!: string;

  @Column({ name: "alias_normalized", type: "text" })
  aliasNormalized!: string;

  @Column({ name: "source", type: "text", default: "auto" })
  source!: "auto" | "manual";

  @Column({ name: "is_active", type: "boolean", default: true })
  isActive!: boolean;

  @Column({ name: "deprecated_at", type: "timestamptz", nullable: true })
  deprecatedAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
