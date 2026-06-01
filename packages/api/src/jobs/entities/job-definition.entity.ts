/**
 * Определение задачи планировщика (ADR-003, Фаза G): что запускать и по какому
 * cron-расписанию. Конкретные запуски — в `job_runs`.
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity({ name: "job_definitions" })
export class JobDefinitionEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "text" })
  type!: string;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  params!: Record<string, unknown>;

  @Column({ type: "text", nullable: true })
  cron!: string | null;

  @Column({ type: "boolean", default: true })
  enabled!: boolean;

  @Column({ name: "priority", type: "integer", default: 0 })
  priority!: number;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
