import type {
  CreateJobDefinition,
  IJobDefinitionRepository,
  JobDefinition,
  JobType,
  UpdateJobDefinition,
} from "@radar/shared";
import type { DataSource } from "typeorm";

type DefRow = {
  id: string;
  type: JobType;
  params: Record<string, unknown>;
  cron: string | null;
  enabled: boolean;
  priority: number;
  created_at: Date;
  updated_at: Date;
};

/** Реестр определений задач планировщика на Postgres (ADR-003, Фаза G). */
export class TypeOrmJobDefinitionRepository implements IJobDefinitionRepository {
  constructor(private readonly dataSource: DataSource) {}

  async listAll(): Promise<JobDefinition[]> {
    const rows = (await this.dataSource.query(
      `SELECT * FROM job_definitions ORDER BY priority DESC, created_at ASC`,
    )) as DefRow[];
    return rows.map((row) => this.toRecord(row));
  }

  async listEnabled(): Promise<JobDefinition[]> {
    const rows = (await this.dataSource.query(
      `SELECT * FROM job_definitions WHERE enabled = true ORDER BY priority DESC, created_at ASC`,
    )) as DefRow[];
    return rows.map((row) => this.toRecord(row));
  }

  async findById(id: string): Promise<JobDefinition | null> {
    const rows = (await this.dataSource.query(
      `SELECT * FROM job_definitions WHERE id = $1`,
      [id],
    )) as DefRow[];
    return rows[0] ? this.toRecord(rows[0]) : null;
  }

  async create(input: CreateJobDefinition): Promise<JobDefinition> {
    const rows = (await this.dataSource.query(
      `INSERT INTO job_definitions (type, params, cron, enabled, priority)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        input.type,
        JSON.stringify(input.params ?? {}),
        input.cron ?? null,
        input.enabled ?? true,
        input.priority ?? 0,
      ],
    )) as DefRow[];
    return this.toRecord(rows[0]);
  }

  async update(id: string, patch: UpdateJobDefinition): Promise<JobDefinition | null> {
    const rows = (await this.dataSource.query(
      `UPDATE job_definitions SET
         cron = COALESCE($2, cron),
         enabled = COALESCE($3, enabled),
         priority = COALESCE($4, priority),
         params = COALESCE($5, params),
         updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        patch.cron === undefined ? null : patch.cron,
        patch.enabled ?? null,
        patch.priority ?? null,
        patch.params ? JSON.stringify(patch.params) : null,
      ],
    )) as DefRow[];
    return rows[0] ? this.toRecord(rows[0]) : null;
  }

  async remove(id: string): Promise<void> {
    await this.dataSource.query(`DELETE FROM job_definitions WHERE id = $1`, [id]);
  }

  private toRecord(row: DefRow): JobDefinition {
    return {
      id: row.id,
      type: row.type,
      params: row.params ?? {},
      cron: row.cron,
      enabled: row.enabled,
      priority: row.priority,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}
