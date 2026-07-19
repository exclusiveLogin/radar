import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "job_geo_place_enrich" })
export class PlaceEnrichmentJobEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "place_id", type: "uuid" })
  placeId!: string;

  @Column({ name: "provider", type: "text" })
  provider!: "dadata" | "llm" | "nominatim";

  @Column({ name: "status", type: "text", default: "pending" })
  status!: "pending" | "processing" | "done" | "failed";

  @Column({ name: "attempts", type: "int", default: 0 })
  attempts!: number;

  @Column({ name: "last_error", type: "text", nullable: true })
  lastError!: string | null;

  @Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
  createdAt!: Date;

  @Column({ name: "updated_at", type: "timestamptz", default: () => "now()" })
  updatedAt!: Date;
}
