/**
 * Запуск задачи планировщика (ADR-003, Фаза G): instance с прогрессом/итогом.
 * Durable-журнал — его читает админка (история и live-прогресс).
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity({ name: "job_runs" })
export class JobRunEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "definition_id", type: "uuid", nullable: true })
  definitionId!: string | null;

  @Column({ type: "text" })
  type!: string;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  params!: Record<string, unknown>;

  @Column({ type: "text", default: "pending" })
  status!: string;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  stats!: Record<string, unknown>;

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
