/**
 * @see ../../../../../docs/database-table-naming.md
 * Покрытие сообщения фазой (job_parse_phase): маркер «фаза X обработала raw_message».
 */
import { Column, Entity, PrimaryGeneratedColumn, Unique } from "typeorm";

type CoverageStatus = "pending" | "processing" | "done" | "failed";

@Entity({ name: "job_parse_phase" })
@Unique("uq_job_parse_phase_raw_phase", ["rawMessageId", "phaseId"])
export class JobParsePhaseEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "raw_message_id", type: "uuid" })
  rawMessageId!: string;

  @Column({ name: "phase_id", type: "text" })
  phaseId!: string;

  @Column({ name: "parsed_event_id", type: "uuid", nullable: true })
  parsedEventId!: string | null;

  @Column({ name: "status", type: "text", default: "pending" })
  status!: CoverageStatus;

  @Column({ name: "attempts", type: "integer", default: 0 })
  attempts!: number;

  @Column({ name: "last_error", type: "text", nullable: true })
  lastError!: string | null;

  @Column({ name: "processed_at", type: "timestamptz", nullable: true })
  processedAt!: Date | null;

  @Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
  createdAt!: Date;

  @Column({ name: "updated_at", type: "timestamptz", default: () => "now()" })
  updatedAt!: Date;
}

/** @deprecated — use JobParsePhaseEntity */
export { JobParsePhaseEntity as PhaseCoverageEntity };
