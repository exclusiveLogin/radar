import type {
  EnrichStage,
  EnrichmentTask,
  EnrichmentTaskStatus,
  IEnrichmentQueueRepository,
} from "@radar/shared";
import type { DataSource } from "typeorm";

type QueueRow = {
  id: string;
  raw_message_id: string;
  parsed_event_id: string | null;
  stage: EnrichStage;
  status: EnrichmentTaskStatus;
  attempts: number;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
};

/**
 * Per-provider очередь обогащения на Postgres (ADR-003). Claim — атомарный
 * `FOR UPDATE SKIP LOCKED` по stage, enqueue — идемпотентный upsert по
 * `(raw_message_id, stage)` (done-задачи не сбрасываются — защита от петли).
 */
export class TypeOrmEnrichmentQueueRepository implements IEnrichmentQueueRepository {
  constructor(private readonly dataSource: DataSource) {}

  async enqueue(input: {
    rawMessageId: string;
    stage: EnrichStage;
    parsedEventId?: string | null;
  }): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO enrichment_queue (raw_message_id, stage, parsed_event_id, status)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (raw_message_id, stage) DO NOTHING`,
      [input.rawMessageId, input.stage, input.parsedEventId ?? null],
    );
  }

  async claimBatch(stage: EnrichStage, limit: number): Promise<EnrichmentTask[]> {
    const rows = (await this.dataSource.query(
      `UPDATE enrichment_queue SET status = 'processing', updated_at = now()
       WHERE id IN (
         SELECT id FROM enrichment_queue
         WHERE status = 'pending' AND stage = $1
         ORDER BY created_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, raw_message_id, parsed_event_id, stage, status, attempts, last_error, created_at, updated_at`,
      [stage, limit],
    )) as QueueRow[];
    return rows.map((row) => this.toTask(row));
  }

  async markDone(id: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE enrichment_queue SET status = 'done', updated_at = now() WHERE id = $1`,
      [id],
    );
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE enrichment_queue
       SET status = 'failed', attempts = attempts + 1, last_error = $2, updated_at = now()
       WHERE id = $1`,
      [id, error.slice(0, 2000)],
    );
  }

  async countByStatus(stage?: EnrichStage): Promise<Record<EnrichmentTaskStatus, number>> {
    const rows = (await this.dataSource.query(
      `SELECT status, COUNT(*)::int AS count FROM enrichment_queue
       WHERE ($1::text IS NULL OR stage = $1)
       GROUP BY status`,
      [stage ?? null],
    )) as Array<{ status: EnrichmentTaskStatus; count: number }>;
    const result: Record<EnrichmentTaskStatus, number> = {
      pending: 0,
      processing: 0,
      done: 0,
      failed: 0,
    };
    for (const row of rows) result[row.status] = row.count;
    return result;
  }

  private toTask(row: QueueRow): EnrichmentTask {
    return {
      id: row.id,
      rawMessageId: row.raw_message_id,
      parsedEventId: row.parsed_event_id,
      stage: row.stage,
      status: row.status,
      attempts: row.attempts,
      lastError: row.last_error ?? undefined,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}
