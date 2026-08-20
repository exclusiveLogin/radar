/**
 * ---
 * layer: worker/application
 * domain: pipeline/step
 * purpose: Журнал log_step_run (open/close) для stepRunner — schema Wave 3.
 * ---
 */
import { randomUUID } from "node:crypto";
import type { OperationalSql } from "../../phases/operationalSql.port.js";

export type StepRunStatus = "running" | "completed" | "failed" | "canceled";

export type LogStepRunRecord = {
  id: string;
  stepId: string;
  runId: string;
  status: StepRunStatus;
  lane: string;
  isolate: boolean;
  correlationId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

type OpenInput = {
  stepId: string;
  /** Корреляция с StepRunContext.runId (unique). */
  runId?: string;
  lane?: string;
  isolate?: boolean;
  correlationId?: string;
  triggerTopic?: string;
  triggerSource?: string;
};

/** SQL-репозиторий log_step_run. */
export class LogStepRunRepository {
  constructor(private readonly sql: OperationalSql) {}

  /** @returns runId (SSOT для событий; journal id хранится отдельно). */
  async open(input: OpenInput): Promise<string> {
    const id = randomUUID();
    const runId = input.runId ?? id;
    await this.sql.query(
      `INSERT INTO log_step_run
        (id, step_id, run_id, status, lane, isolate, correlation_id,
         trigger_topic, trigger_source, started_at)
       VALUES ($1, $2, $3, 'running', $4, $5, $6, $7, $8, now())`,
      [
        id,
        input.stepId,
        runId,
        input.lane ?? "manual",
        input.isolate ?? false,
        input.correlationId ?? randomUUID(),
        input.triggerTopic ?? "",
        input.triggerSource ?? "manual",
      ],
    );
    return runId;
  }

  async close(
    runId: string,
    status: Exclude<StepRunStatus, "running">,
    stats?: Record<string, unknown>,
    _error?: string,
  ): Promise<void> {
    await this.sql.query(
      `UPDATE log_step_run
       SET status = $2,
           finished_at = now(),
           stats = COALESCE($3::jsonb, stats),
           suppressed_emits = COALESCE($4::jsonb, suppressed_emits),
           updated_at = now()
       WHERE run_id = $1`,
      [
        runId,
        status,
        stats ? JSON.stringify(stats) : null,
        stats?.suppressedEmits ? JSON.stringify(stats.suppressedEmits) : null,
      ],
    );
  }

  async findLatestByStep(stepId: string): Promise<LogStepRunRecord | null> {
    const rows = await this.sql.query<{
      id: string;
      step_id: string;
      run_id: string;
      status: StepRunStatus;
      lane: string;
      isolate: boolean;
      correlation_id: string | null;
      started_at: Date | string | null;
      finished_at: Date | string | null;
    }>(
      `SELECT id, step_id, run_id, status, lane, isolate, correlation_id, started_at, finished_at
       FROM log_step_run
       WHERE step_id = $1
       ORDER BY started_at DESC NULLS LAST
       LIMIT 1`,
      [stepId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      stepId: row.step_id,
      runId: row.run_id,
      status: row.status,
      lane: row.lane,
      isolate: row.isolate,
      correlationId: row.correlation_id,
      startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
      finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
    };
  }

  async findActiveIsolateStepId(): Promise<string | null> {
    const rows = await this.sql.query<{ step_id: string }>(
      `SELECT step_id FROM log_step_run
       WHERE status = 'running' AND isolate = true
       ORDER BY started_at DESC NULLS LAST
       LIMIT 1`,
    );
    return rows[0]?.step_id ?? null;
  }
}
