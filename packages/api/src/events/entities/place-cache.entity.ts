import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "place_cache" })
export class PlaceCacheEntity {
  @PrimaryColumn({ name: "query_norm", type: "text" })
  queryNorm!: string;

  @PrimaryColumn({ name: "provider", type: "text" })
  provider!: "dadata" | "nominatim" | "llm";

  @Column({ name: "region_id", type: "uuid", nullable: true })
  regionId!: string | null;

  @Column({ name: "place_id", type: "uuid", nullable: true })
  placeId!: string | null;

  @Column({ name: "fias", type: "text", nullable: true })
  fias!: string | null;

  @Column({ name: "oktmo", type: "text", nullable: true })
  oktmo!: string | null;

  @Column({ name: "lat", type: "numeric", precision: 9, scale: 6, nullable: true })
  lat!: string | null;

  @Column({ name: "lon", type: "numeric", precision: 9, scale: 6, nullable: true })
  lon!: string | null;

  @Column({ name: "raw", type: "jsonb", default: () => "'{}'::jsonb" })
  raw!: Record<string, unknown>;

  @Column({ name: "fetched_at", type: "timestamptz", default: () => "now()" })
  fetchedAt!: Date;

  @Column({ name: "validated_at", type: "timestamptz", nullable: true })
  validatedAt!: Date | null;

  @Column({ name: "validator", type: "text", nullable: true })
  validator!: "rule" | "human" | "provider" | null;

  @Column({ name: "confidence", type: "numeric", precision: 4, scale: 3, nullable: true })
  confidence!: string | null;

  @Column({ name: "expires_at", type: "timestamptz", nullable: true })
  expiresAt!: Date | null;
}
