import {
  resolveRawMessagePostedAtOrder,
  type IPhaseCoverageRepository,
  type PhaseCoverageStatus,
  type PhaseCoverageTask,
} from "@radar/shared";
import type { DataSource } from "typeorm";
import {
  pgTimestampToIso,
  pgTimestampToIsoOptional,
  readTypeOrmQueryRows,
} from "./typeorm-query-rows";

type CoverageRow = {
  id: string;
  raw_message_id: string;
  phase_id: string;
  parsed_event_id: string | null;
  status: PhaseCoverageStatus;
  attempts: number;
  last_error: string | null;
  processed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

/** Покрытие per-phase на Postgres (phase_coverage). */
export class TypeOrmPhaseCoverageRepository implements IPhaseCoverageRepository {
  constructor(private readonly dataSource: DataSource) {}

  async enqueuePending(input: {
    rawMessageId: string;
    phaseId: string;
    parsedEventId?: string | null;
  }): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO phase_coverage (raw_message_id, phase_id, parsed_event_id, status)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (raw_message_id, phase_id) DO NOTHING`,
      [input.rawMessageId, input.phaseId, input.parsedEventId ?? null],
    );
  }

  async enqueueCatchUp(phaseId: string): Promise<{ enqueued: number }> {
    const rows = readTypeOrmQueryRows<{ id: string }>(
      await this.dataSource.query(
        `INSERT INTO phase_coverage (raw_message_id, phase_id, status)
       SELECT rm.id, $1, 'pending'
       FROM raw_messages rm
       WHERE NOT EXISTS (
         SELECT 1 FROM phase_coverage pc
         WHERE pc.raw_message_id = rm.id AND pc.phase_id = $1 AND pc.status = 'done'
       )
       ON CONFLICT (raw_message_id, phase_id) DO NOTHING
       RETURNING id`,
        [phaseId],
      ),
    );
    return { enqueued: rows.length };
  }

  async claimBatch(
    phaseId: string,
    limit: number,
    prerequisitePhaseIds: string[] = [],
  ): Promise<PhaseCoverageTask[]> {
    const prereq =
      prerequisitePhaseIds.length > 0
        ? `AND NOT EXISTS (
             SELECT 1 FROM phase_coverage prereq
             WHERE prereq.raw_message_id = pc.raw_message_id
               AND prereq.phase_id = ANY($3::text[])
               AND prereq.status <> 'done'
           )`
        : "";
    const params =
      prerequisitePhaseIds.length > 0
        ? [phaseId, limit, prerequisitePhaseIds]
        : [phaseId, limit];

    const postedOrder = resolveRawMessagePostedAtOrder();
    const createdOrder = postedOrder === "DESC" ? "DESC" : "ASC";

    const rows = readTypeOrmQueryRows<CoverageRow>(
      await this.dataSource.query(
        `UPDATE phase_coverage SET status = 'processing', updated_at = now()
       WHERE id IN (
         SELECT pc.id FROM phase_coverage pc
         INNER JOIN raw_messages rm ON rm.id = pc.raw_message_id
         WHERE pc.status = 'pending' AND pc.phase_id = $1
         ${prereq}
         ORDER BY rm.posted_at ${postedOrder}, pc.created_at ${createdOrder}
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, raw_message_id, phase_id, parsed_event_id, status, attempts,
                 last_error, processed_at, created_at, updated_at`,
        params,
      ),
    );
    return rows.map((row) => this.toTask(row));
  }

  async markDone(id: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE phase_coverage SET status = 'done', processed_at = now(), updated_at = now()
       WHERE id = $1`,
      [id],
    );
  }

  async markDoneForMessage(rawMessageId: string, phaseId: string): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO phase_coverage (raw_message_id, phase_id, status, processed_at)
       VALUES ($1, $2, 'done', now())
       ON CONFLICT (raw_message_id, phase_id) DO UPDATE
         SET status = 'done', processed_at = now(), updated_at = now(), last_error = NULL`,
      [rawMessageId, phaseId],
    );
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE phase_coverage SET status = 'failed', attempts = attempts + 1,
       last_error = $2, updated_at = now() WHERE id = $1`,
      [id, error.slice(0, 2000)],
    );
  }

  async resetProcessingForPhase(phaseId: string): Promise<number> {
    const rows = readTypeOrmQueryRows<{ id: string }>(
      await this.dataSource.query(
        `UPDATE phase_coverage SET status = 'pending', updated_at = now()
       WHERE phase_id = $1 AND status = 'processing'
       RETURNING id`,
        [phaseId],
      ),
    );
    return rows.length;
  }

  async clearQueuedWork(phaseIds?: string[]): Promise<number> {
    const rows = readTypeOrmQueryRows<{ id: string }>(
      await this.dataSource.query(
        `DELETE FROM phase_coverage
       WHERE status IN ('pending', 'processing')
         AND ($1::text[] IS NULL OR phase_id = ANY($1::text[]))
       RETURNING id`,
        [phaseIds?.length ? phaseIds : null],
      ),
    );
    return rows.length;
  }

  async invalidateForPhases(phaseIds: string[]): Promise<number> {
    if (phaseIds.length === 0) return 0;
    const rows = readTypeOrmQueryRows<{ id: string }>(
      await this.dataSource.query(
        `UPDATE phase_coverage SET status = 'pending', processed_at = NULL, last_error = NULL,
       updated_at = now()
       WHERE phase_id = ANY($1::text[]) AND status IN ('done', 'failed', 'processing')
       RETURNING id`,
        [phaseIds],
      ),
    );
    return rows.length;
  }

  async countByStatus(phaseId?: string): Promise<Record<PhaseCoverageStatus, number>> {
    const rows = (await this.dataSource.query(
      `SELECT status, COUNT(*)::int AS count FROM phase_coverage
       WHERE ($1::text IS NULL OR phase_id = $1)
       GROUP BY status`,
      [phaseId ?? null],
    )) as Array<{ status: PhaseCoverageStatus; count: number }>;
    const result: Record<PhaseCoverageStatus, number> = {
      pending: 0,
      processing: 0,
      done: 0,
      failed: 0,
    };
    for (const row of rows) result[row.status] = row.count;
    return result;
  }

  private toTask(row: CoverageRow): PhaseCoverageTask {
    return {
      id: row.id,
      rawMessageId: row.raw_message_id,
      phaseId: row.phase_id,
      parsedEventId: row.parsed_event_id,
      status: row.status,
      attempts: row.attempts,
      lastError: row.last_error ?? undefined,
      processedAt: pgTimestampToIsoOptional(row.processed_at),
      createdAt: pgTimestampToIso(row.created_at),
      updatedAt: pgTimestampToIso(row.updated_at),
    };
  }
}

/** @deprecated Алиас таблицы phase_coverage */
export class TypeOrmEnrichmentQueueRepository extends TypeOrmPhaseCoverageRepository {
  async enqueue(input: {
    rawMessageId: string;
    stage: string;
    parsedEventId?: string | null;
  }): Promise<void> {
    return this.enqueuePending({
      rawMessageId: input.rawMessageId,
      phaseId: input.stage,
      parsedEventId: input.parsedEventId,
    });
  }

  async claimBatch(stage: string, limit: number): Promise<PhaseCoverageTask[]> {
    return super.claimBatch(stage, limit);
  }

  async countByStatus(stage?: string): Promise<Record<PhaseCoverageStatus, number>> {
    return super.countByStatus(stage);
  }
}
