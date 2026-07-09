/**
 * @see ../../../../../docs/database-table-naming.md
 * @deprecated Алиас PhaseCoverageEntity — та же таблица queue_parse_coverage с PhasePipelineV2.
 * Per-provider очередь (ADR-003): строка на пару `(raw_message_id, phase_id)`.
 */
import { Column, Entity, PrimaryGeneratedColumn, Unique } from "typeorm";

type EnrichmentStatus = "pending" | "processing" | "done" | "failed";

@Entity({ name: "queue_parse_coverage" })
@Unique("uq_queue_parse_coverage_raw_phase", ["rawMessageId", "phaseId"])
export class EnrichmentQueueEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "raw_message_id", type: "uuid" })
  rawMessageId!: string;

  @Column({ name: "phase_id", type: "text" })
  phaseId!: string;

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
