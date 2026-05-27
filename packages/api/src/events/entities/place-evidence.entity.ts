/**
 * Почему у place такой trust: кто (dadata/llm/operator) и с какой уверенностью подтвердил или обогатил поля.
 * Позволяет объяснить оператору расхождение с текстом канала; сами координаты живут в `places`, не здесь.
 * @see ../../../../../docs/domain/persistence-map.md#PlaceEvidenceEntity
 * @see ../../../../../docs/domain/contexts/geo-place.md
 * @see ../../../../../docs/place-trust-explained.md
 */
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { PlaceEntity } from "../../geo/entities";

@Entity({ name: "place_evidence" })
export class PlaceEvidenceEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "place_id", type: "uuid" })
  placeId!: string;

  @ManyToOne(() => PlaceEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "place_id" })
  place!: PlaceEntity;

  @Column({ name: "provider", type: "text" })
  provider!: "catalog" | "dadata" | "nominatim" | "llm" | "operator" | "system";

  @Column({ name: "action", type: "text" })
  action!: "candidate" | "confirm" | "reject" | "enrich";

  @Column({ name: "confidence", type: "numeric", precision: 4, scale: 3, nullable: true })
  confidence!: string | null;

  @Column({ name: "payload", type: "jsonb", default: () => "'{}'::jsonb" })
  payload!: Record<string, unknown>;

  @Column({ name: "trace_id", type: "text", nullable: true })
  traceId!: string | null;

  @Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
  createdAt!: Date;
}
