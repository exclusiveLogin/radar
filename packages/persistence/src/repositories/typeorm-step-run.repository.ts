import type {
  IStepRunRepository,
  IngestMode,
  StepRunOpenInput,
  StepRunRecord,
  StepRunStatus,
  StepRunSuppressedEmit,
  StepTriggerSource,
} from "@radar/shared";
import type { DataSource } from "typeorm";
import {
  pgTimestampToIso,
  pgTimestampToIsoOptional,
  readTypeOrmQueryRows,
} from "./typeorm-query-rows";

type StepRunRow = {
  id: string;
  step_id: string;
  run_id: string;
  lane: string;
  isolate: boolean;
  trigger_topic: string;
  trigger_source: string;
  correlation_id: string;
  status: string;
  stats: Record<string, unknown>;
  suppressed_emits: StepRunSuppressedEmit[];
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

/** Журнал запусков шага (log_step_run). */
export class TypeOrmStepRunRepository implements IStepRunRepository {
  constructor(private readonly dataSource: DataSource) {}

  async open(input: StepRunOpenInput): Promise<StepRunRecord> {
    const rows = readTypeOrmQueryRows<StepRunRow>(
      await this.dataSource.query(
        `INSERT INTO log_step_run (
           step_id, run_id, lane, isolate, trigger_topic, trigger_source,
           correlation_id, status, started_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'running', now())
         RETURNING *`,
        [
          input.stepId,
          input.runId,
          input.lane,
          input.isolate,
          input.triggerTopic,
          input.triggerSource,
          input.correlationId,
        ],
      ),
    );
    return this.toRecord(rows[0]!);
  }

  async findByRunId(runId: string): Promise<StepRunRecord | null> {
    const rows = readTypeOrmQueryRows<StepRunRow>(
      await this.dataSource.query(`SELECT * FROM log_step_run WHERE run_id = $1`, [runId]),
    );
    return rows[0] ? this.toRecord(rows[0]) : null;
  }

  async close(
    runId: string,
    patch: {
      status: StepRunStatus;
      stats?: Record<string, unknown>;
      suppressedEmits?: StepRunSuppressedEmit[];
    },
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE log_step_run SET
         status = $2,
         stats = COALESCE($3::jsonb, stats),
         suppressed_emits = COALESCE($4::jsonb, suppressed_emits),
         finished_at = now(),
         updated_at = now()
       WHERE run_id = $1`,
      [
        runId,
        patch.status,
        patch.stats ? JSON.stringify(patch.stats) : null,
        patch.suppressedEmits ? JSON.stringify(patch.suppressedEmits) : null,
      ],
    );
  }

  private toRecord(row: StepRunRow): StepRunRecord {
    return {
      id: row.id,
      stepId: row.step_id,
      runId: row.run_id,
      lane: row.lane as IngestMode,
      isolate: Boolean(row.isolate),
      triggerTopic: row.trigger_topic,
      triggerSource: row.trigger_source as StepTriggerSource,
      correlationId: row.correlation_id,
      status: row.status as StepRunStatus,
      stats: row.stats ?? {},
      suppressedEmits: Array.isArray(row.suppressed_emits) ? row.suppressed_emits : [],
      startedAt: pgTimestampToIsoOptional(row.started_at) ?? null,
      finishedAt: pgTimestampToIsoOptional(row.finished_at) ?? null,
      createdAt: pgTimestampToIso(row.created_at),
      updatedAt: pgTimestampToIso(row.updated_at),
    };
  }
}
