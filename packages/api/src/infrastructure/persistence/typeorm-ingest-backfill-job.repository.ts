import type {
  BackfillJobFilter,
  BackfillJobRecord,
  CreateBackfillJob,
  IIngestBackfillJobRepository,
} from "@radar/shared";
import { randomUUID } from "node:crypto";
import { In, type DataSource } from "typeorm";
import { IngestBackfillJobEntity } from "../../ingest/entities";
import { toBackfillJobRecord } from "./ingest-mappers";
import { readTypeOrmQueryRows } from "./typeorm-query-rows";

/** Статусы, которые ещё можно отменить (демон их не завершил). */
const CANCELABLE_STATUSES = ["pending", "running"];

export class TypeOrmIngestBackfillJobRepository implements IIngestBackfillJobRepository {
  constructor(private readonly dataSource: DataSource) {}

  async create(input: CreateBackfillJob & { providerId: string }): Promise<BackfillJobRecord> {
    const repo = this.dataSource.getRepository(IngestBackfillJobEntity);
    const row = repo.create({
      id: randomUUID(),
      bindingId: input.bindingId,
      providerId: input.providerId,
      strategy: input.strategy,
      params: input.params as Record<string, unknown>,
      status: "pending",
      stats: { inserted: 0, duplicates: 0, parsed: 0 },
    });
    const saved = await repo.save(row);
    return toBackfillJobRecord(saved);
  }

  async findById(id: string): Promise<BackfillJobRecord | null> {
    const row = await this.dataSource.getRepository(IngestBackfillJobEntity).findOne({ where: { id } });
    return row ? toBackfillJobRecord(row) : null;
  }

  async findMany(filter: BackfillJobFilter = {}): Promise<BackfillJobRecord[]> {
    const repo = this.dataSource.getRepository(IngestBackfillJobEntity);
    const rows = await repo.find({
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.bindingId ? { bindingId: filter.bindingId } : {}),
      },
      order: { createdAt: "DESC" },
      take: filter.limit ?? 50,
    });
    return rows.map(toBackfillJobRecord);
  }

  async requestCancel(id: string): Promise<BackfillJobRecord | null> {
    const repo = this.dataSource.getRepository(IngestBackfillJobEntity);
    const row = await repo.findOne({ where: { id } });
    if (!row) return null;
    if (CANCELABLE_STATUSES.includes(row.status)) {
      await repo.update({ id, status: In(CANCELABLE_STATUSES) }, { status: "canceled" });
      const updated = await repo.findOne({ where: { id } });
      return updated ? toBackfillJobRecord(updated) : null;
    }
    return toBackfillJobRecord(row);
  }

  async findRunnable(): Promise<BackfillJobRecord | null> {
    const rows = await this.findRunnableMany(1);
    return rows[0] ?? null;
  }

  async findRunnableMany(limit = 32): Promise<BackfillJobRecord[]> {
    const claimed = await this.claimPendingJobs(limit);
    const running = await this.listRunningJobs(Math.max(0, limit - claimed.length));
    return [...claimed, ...running];
  }

  /** pending → running с FOR UPDATE SKIP LOCKED (безопасно для нескольких backfill-worker). */
  private async claimPendingJobs(limit: number): Promise<BackfillJobRecord[]> {
    if (limit <= 0) return [];

    const rows = readTypeOrmQueryRows<{
        id: string;
        binding_id: string;
        provider_id: string;
        strategy: string;
        params: Record<string, unknown>;
        status: string;
        stats: BackfillJobRecord["stats"];
        created_at: Date;
        updated_at: Date;
      }>(
      await this.dataSource.query(
      `UPDATE ingest_backfill_jobs
       SET status = 'running', updated_at = NOW()
       WHERE id IN (
         SELECT id FROM ingest_backfill_jobs
         WHERE status = 'pending'
         ORDER BY created_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, binding_id, provider_id, strategy, params, status, stats, created_at, updated_at`,
        [limit],
      ),
    );

    return rows.map((row) =>
      toBackfillJobRecord({
        id: row.id,
        bindingId: row.binding_id,
        providerId: row.provider_id,
        strategy: row.strategy,
        params: row.params,
        status: row.status,
        stats: row.stats,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      } as IngestBackfillJobEntity),
    );
  }

  private async listRunningJobs(limit: number): Promise<BackfillJobRecord[]> {
    if (limit <= 0) return [];
    const rows = await this.dataSource.getRepository(IngestBackfillJobEntity).find({
      where: { status: "running" },
      order: { createdAt: "ASC" },
      take: limit,
    });
    return rows.map(toBackfillJobRecord);
  }

  async updateProgress(
    id: string,
    patch: { stats?: BackfillJobRecord["stats"]; params?: Record<string, unknown> },
  ): Promise<void> {
    if (!patch.stats && !patch.params) return;

    const repo = this.dataSource.getRepository(IngestBackfillJobEntity);
    const row = await repo.findOne({ where: { id } });
    if (!row) return;

    if (patch.stats) row.stats = patch.stats;
    if (patch.params) row.params = patch.params;
    await repo.save(row);
  }

  /** Пульс мониторинга: только updated_at (round-robin / длинный батч). */
  async touch(id: string): Promise<void> {
    await this.dataSource
      .getRepository(IngestBackfillJobEntity)
      .update({ id }, { updatedAt: new Date() });
  }

  async updateStatus(
    id: string,
    status: BackfillJobRecord["status"],
    stats?: BackfillJobRecord["stats"],
  ): Promise<void> {
    await this.dataSource.getRepository(IngestBackfillJobEntity).update(
      { id },
      stats ? { status, stats } : { status },
    );
  }
}
