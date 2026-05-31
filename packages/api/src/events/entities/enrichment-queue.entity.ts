/**
 * Очередь фонового гео-обогащения: одна задача на raw_message.
 * Синхронный catalog-парсинг ставит задачу, фоновый worker:enrich:run
 * догоняет её полным пайплайном (llm/dadata/nominatim) и обновляет проекцию.
 */
import { Column, Entity, PrimaryGeneratedColumn, Unique } from "typeorm";

type EnrichmentStatus = "pending" | "processing" | "done" | "failed";

@Entity({ name: "enrichment_queue" })
@Unique("uq_enrichment_queue_raw_message", ["rawMessageId"])
export class EnrichmentQueueEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "raw_message_id", type: "uuid" })
  rawMessageId!: string;

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
