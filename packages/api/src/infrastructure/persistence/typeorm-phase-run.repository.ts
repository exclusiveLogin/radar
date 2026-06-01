import type {
  IPhaseRunRepository,
  ManualRunScope,
  PhaseRun,
  PhaseRunControl,
  PhaseRunFilter,
  PhaseRunLogEntry,
  PhaseRunStats,
  PhaseRunStatus,
  PhaseTrigger,
} from "@radar/shared";
import { phaseRunStatsSchema } from "@radar/shared";
import { resolveRawMessagePostedAtOrder } from "@radar/shared";
import type { DataSource } from "typeorm";
import {
  pgTimestampToIso,
  pgTimestampToIsoOptional,
  readTypeOrmQueryRows,
} from "./typeorm-query-rows.js";

const MAX_LOG_ENTRIES = 50;
const LOG_TAIL_API = 4;

type RunRow = {
  id: string;
  phase_id: string;
  trigger: string;
  status: PhaseRunStatus;
  stats: Record<string, unknown>;
  log: PhaseRunLogEntry[];
  control: string | null;
  error: string | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

/** Запуски фаз (phase_runs): прогресс, лог, control. */
export class TypeOrmPhaseRunRepository implements IPhaseRunRepository {
  constructor(private readonly dataSource: DataSource) {}

  async create(input: {
    phaseId: string;
    trigger: PhaseTrigger;
    status?: PhaseRunStatus;
  }): Promise<PhaseRun> {
    const rows = readTypeOrmQueryRows<RunRow>(
      await this.dataSource.query(
        `INSERT INTO phase_runs (phase_id, trigger, status, started_at)
       VALUES ($1, $2, $3, CASE WHEN $3 = 'running' THEN now() ELSE NULL END)
       RETURNING *`,
        [input.phaseId, input.trigger, input.status ?? "pending"],
      ),
    );
    return this.toRun(rows[0]!);
  }

  async findById(id: string): Promise<PhaseRun | null> {
    const rows = (await this.dataSource.query(`SELECT * FROM phase_runs WHERE id = $1`, [
      id,
    ])) as RunRow[];
    return rows[0] ? this.toRun(rows[0]) : null;
  }

  async listActive(): Promise<PhaseRun[]> {
    return this.list({ status: "running", limit: 50 });
  }

  async list(filter?: PhaseRunFilter): Promise<PhaseRun[]> {
    const limit = Math.min(filter?.limit ?? 50, 200);
    const rows = (await this.dataSource.query(
      `SELECT * FROM phase_runs
       WHERE ($1::text IS NULL OR phase_id = $1)
         AND ($2::text IS NULL OR status = $2)
         AND ($3::text IS NULL OR trigger = $3)
       ORDER BY created_at DESC
       LIMIT $4`,
      [filter?.phaseId ?? null, filter?.status ?? null, filter?.trigger ?? null, limit],
    )) as RunRow[];
    return rows.map((row) => this.toRun(row));
  }

  async appendLog(id: string, entry: PhaseRunLogEntry): Promise<void> {
    await this.dataSource.query(
      `UPDATE phase_runs SET
         log = (
           SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
           FROM (
             SELECT elem FROM jsonb_array_elements(
               COALESCE(log, '[]'::jsonb) || jsonb_build_array($2::jsonb)
             ) WITH ORDINALITY AS t(elem, ord)
             ORDER BY ord DESC
             LIMIT $3
           ) sub(elem)
         ),
         updated_at = now()
       WHERE id = $1`,
      [id, JSON.stringify(entry), MAX_LOG_ENTRIES],
    );
  }

  async updateStats(id: string, stats: PhaseRunStats): Promise<void> {
    await this.dataSource.query(
      `UPDATE phase_runs SET stats = $2::jsonb, updated_at = now() WHERE id = $1`,
      [id, JSON.stringify(stats)],
    );
  }

  async requestControl(id: string, control: PhaseRunControl): Promise<void> {
    await this.dataSource.query(
      `UPDATE phase_runs SET control = $2, updated_at = now() WHERE id = $1`,
      [id, control],
    );
  }

  async clearControl(id: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE phase_runs SET control = NULL, updated_at = now() WHERE id = $1`,
      [id],
    );
  }

  async getControl(id: string): Promise<PhaseRunControl | null> {
    const rows = (await this.dataSource.query(
      `SELECT control FROM phase_runs WHERE id = $1`,
      [id],
    )) as Array<{ control: string | null }>;
    const control = rows[0]?.control;
    return control === "cancel" || control === "pause" ? control : null;
  }

  async updateStatus(
    id: string,
    status: PhaseRunStatus,
    patch?: { stats?: PhaseRunStats; error?: string | null },
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE phase_runs SET
         status = $2,
         stats = COALESCE($3::jsonb, stats),
         error = COALESCE($4, error),
         started_at = CASE WHEN $2 = 'running' AND started_at IS NULL THEN now() ELSE started_at END,
         finished_at = CASE WHEN $2 IN ('completed','failed','canceled','paused') THEN now() ELSE finished_at END,
         updated_at = now()
       WHERE id = $1`,
      [
        id,
        status,
        patch?.stats ? JSON.stringify(patch.stats) : null,
        patch?.error !== undefined ? patch.error : null,
      ],
    );
  }

  async findRawIdsForManualRun(phaseId: string, scope?: ManualRunScope): Promise<string[]> {
    const params: unknown[] = [phaseId];
    let sql = `
      SELECT rm.id FROM raw_messages rm
      WHERE NOT EXISTS (
        SELECT 1 FROM phase_coverage pc
        WHERE pc.raw_message_id = rm.id AND pc.phase_id = $1 AND pc.status = 'done'
      )`;

    if (scope?.fromPostedAt) {
      params.push(scope.fromPostedAt);
      sql += ` AND rm.posted_at >= $${params.length}::timestamptz`;
    }
    if (scope?.toPostedAt) {
      params.push(scope.toPostedAt);
      sql += ` AND rm.posted_at <= $${params.length}::timestamptz`;
    }

    const order = scope?.tail ? "DESC" : resolveRawMessagePostedAtOrder();
    sql += ` ORDER BY rm.posted_at ${order}`;

    if (scope?.limit) {
      params.push(scope.limit);
      sql += ` LIMIT $${params.length}`;
    }

    const rows = (await this.dataSource.query(sql, params)) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  /** Последние N записей лога для API detail. */
  logTail(run: PhaseRun, n = LOG_TAIL_API): PhaseRunLogEntry[] {
    return run.log.slice(-n);
  }

  private toRun(row: RunRow): PhaseRun {
    const stats = phaseRunStatsSchema.parse(row.stats ?? {});
    return {
      id: row.id,
      phaseId: row.phase_id,
      trigger: row.trigger as PhaseTrigger,
      status: row.status,
      stats,
      log: Array.isArray(row.log) ? row.log : [],
      control:
        row.control === "cancel" || row.control === "pause" ? row.control : null,
      error: row.error,
      startedAt: pgTimestampToIsoOptional(row.started_at) ?? null,
      finishedAt: pgTimestampToIsoOptional(row.finished_at) ?? null,
      createdAt: pgTimestampToIso(row.created_at),
      updatedAt: pgTimestampToIso(row.updated_at),
    };
  }
}
