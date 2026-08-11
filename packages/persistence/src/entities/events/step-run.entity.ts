/**
 * @see ../../../../../docs/database-table-naming.md
 * Журнал declarative step-run (lane / isolate / suppressed emits).
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity({ name: "log_step_run" })
export class StepRunEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "step_id", type: "text" })
  stepId!: string;

  @Column({ name: "run_id", type: "text", unique: true })
  runId!: string;

  @Column({ type: "text" })
  lane!: string;

  @Column({ type: "boolean", default: false })
  isolate!: boolean;

  @Column({ name: "trigger_topic", type: "text" })
  triggerTopic!: string;

  @Column({ name: "trigger_source", type: "text" })
  triggerSource!: string;

  @Column({ name: "correlation_id", type: "text" })
  correlationId!: string;

  @Column({ type: "text", default: "running" })
  status!: string;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  stats!: Record<string, unknown>;

  @Column({ name: "suppressed_emits", type: "jsonb", default: () => "'[]'::jsonb" })
  suppressedEmits!: Array<{
    key: string;
    payloadSummary: Record<string, unknown>;
    downstreamStepIds: string[];
  }>;

  @Column({ name: "started_at", type: "timestamptz", nullable: true })
  startedAt!: Date | null;

  @Column({ name: "finished_at", type: "timestamptz", nullable: true })
  finishedAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
