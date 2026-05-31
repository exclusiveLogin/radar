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
    const row = await this.dataSource.getRepository(IngestBackfillJobEntity).findOne({
      where: [{ status: "pending" }, { status: "running" }],
      order: { createdAt: "ASC" },
    });
    return row ? toBackfillJobRecord(row) : null;
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
