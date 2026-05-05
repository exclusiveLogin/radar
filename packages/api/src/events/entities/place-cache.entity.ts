import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "place_cache" })
export class PlaceCacheEntity {
  @PrimaryColumn({ name: "query_norm", type: "text" })
  queryNorm!: string;

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

  @Column({ name: "provider", type: "text" })
  provider!: "dadata" | "nominatim" | "llm";

  @Column({ name: "raw", type: "jsonb", default: () => "'{}'::jsonb" })
  raw!: Record<string, unknown>;

  @Column({ name: "fetched_at", type: "timestamptz", default: () => "now()" })
  fetchedAt!: Date;
}
