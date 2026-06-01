/**
 * Per-provider очередь фонового обогащения (ADR-003): строка на пару
 * `(raw_message_id, stage)`. Eager catalog-парсинг ставит задачи по включённым
 * lazy-фазам, ранер `worker:enrich:run --stage` догоняет проход и мержит вклад.
 */
import { Column, Entity, PrimaryGeneratedColumn, Unique } from "typeorm";

type EnrichmentStatus = "pending" | "processing" | "done" | "failed";
type EnrichStage = "llm" | "dadata" | "nominatim";

@Entity({ name: "enrichment_queue" })
@Unique("uq_enrichment_queue_raw_stage", ["rawMessageId", "stage"])
export class EnrichmentQueueEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "raw_message_id", type: "uuid" })
  rawMessageId!: string;

  @Column({ name: "stage", type: "text" })
  stage!: EnrichStage;

  @Column({ name: "parsed_event_id", type: "uuid", nullable: true })
  parsedEventId!: string | null;

  @Column({ name: "status", type: "text", default: "pending" })
  status!: EnrichmentStatus;

  @Column({ name: "attempts", type: "integer", default: 0 })
  attempts!: number;

  @Column({ name: "last_error", type: "text", nullable: true })
  lastError!: string | null;

  @Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
  createdAt!: Date;

  @Column({ name: "updated_at", type: "timestamptz", default: () => "now()" })
  updatedAt!: Date;
}
