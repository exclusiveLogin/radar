import type {
  IJobRunRepository,
  JobRun,
  JobRunFilter,
  JobRunStatus,
  JobType,
} from "@radar/shared";
import type { DataSource } from "typeorm";

type RunRow = {
  id: string;
  definition_id: string | null;
  type: JobType;
  params: Record<string, unknown>;
  status: JobRunStatus;
  stats: Record<string, unknown>;
  error: string | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

/** Запуски задач планировщика на Postgres (ADR-003, Фаза G). */
export class TypeOrmJobRunRepository implements IJobRunRepository {
  constructor(private readonly dataSource: DataSource) {}

  async create(input: {
    definitionId?: string | null;
    type: JobType;
    params?: Record<string, unknown>;
  }): Promise<JobRun> {
    const rows = (await this.dataSource.query(
      `INSERT INTO job_runs (definition_id, type, params, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING *`,
      [input.definitionId ?? null, input.type, JSON.stringify(input.params ?? {})],
    )) as RunRow[];
    return this.toRecord(rows[0]);
  }

  async findById(id: string): Promise<JobRun | null> {
    const rows = (await this.dataSource.query(
      `SELECT * FROM job_runs WHERE id = $1`,
      [id],
    )) as RunRow[];
    return rows[0] ? this.toRecord(rows[0]) : null;
  }

  async findRunnable(): Promise<JobRun | null> {
    const rows = (await this.dataSource.query(
      `SELECT * FROM job_runs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1`,
    )) as RunRow[];
    return rows[0] ? this.toRecord(rows[0]) : null;
  }

  async latestForDefinition(definitionId: string): Promise<JobRun | null> {
    const rows = (await this.dataSource.query(
      `SELECT * FROM job_runs WHERE definition_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [definitionId],
    )) as RunRow[];
    return rows[0] ? this.toRecord(rows[0]) : null;
  }

  async updateStatus(
    id: string,
    status: JobRunStatus,
    patch?: { stats?: Record<string, unknown>; error?: string | null },
  ): Promise<void> {
    const startedAt = status === "running" ? "now()" : "started_at";
    const finishedAt =
      status === "completed" || status === "failed" || status === "canceled"
        ? "now()"
        : "finished_at";
    await this.dataSource.query(
      `UPDATE job_runs SET
         status = $2,
         stats = COALESCE($3, stats),
         error = $4,
         started_at = ${startedAt},
         finished_at = ${finishedAt},
         updated_at = now()
       WHERE id = $1`,
      [id, status, patch?.stats ? JSON.stringify(patch.stats) : null, patch?.error ?? null],
    );
  }

  async list(filter?: JobRunFilter): Promise<JobRun[]> {
    const rows = (await this.dataSource.query(
      `SELECT * FROM job_runs
       WHERE ($1::uuid IS NULL OR definition_id = $1)
         AND ($2::text IS NULL OR type = $2)
         AND ($3::text IS NULL OR status = $3)
       ORDER BY created_at DESC
       LIMIT $4`,
      [
        filter?.definitionId ?? null,
        filter?.type ?? null,
        filter?.status ?? null,
        filter?.limit ?? 50,
      ],
    )) as RunRow[];
    return rows.map((row) => this.toRecord(row));
  }

  private toRecord(row: RunRow): JobRun {
    return {
      id: row.id,
      definitionId: row.definition_id,
      type: row.type,
      params: row.params ?? {},
      status: row.status,
      stats: row.stats ?? {},
      error: row.error,
      startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
      finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}
