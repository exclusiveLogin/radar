/**
 * @see ../../../../../docs/database-table-naming.md
 * Запуск фазы: прогресс, ring-log, кооперативное управление (cancel/pause).
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity({ name: "log_phase_run" })
export class PhaseRunEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "phase_id", type: "text" })
  phaseId!: string;

  @Column({ type: "text" })
  trigger!: string;

  @Column({ type: "text", default: "pending" })
  status!: string;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  stats!: Record<string, unknown>;

  @Column({ type: "jsonb", default: () => "'[]'::jsonb" })
  log!: Array<{ at: string; level: string; message: string }>;

  @Column({ type: "text", nullable: true })
  control!: string | null;

  @Column({ type: "text", nullable: true })
  error!: string | null;

  @Column({ name: "started_at", type: "timestamptz", nullable: true })
  startedAt!: Date | null;

  @Column({ name: "finished_at", type: "timestamptz", nullable: true })
  finishedAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
