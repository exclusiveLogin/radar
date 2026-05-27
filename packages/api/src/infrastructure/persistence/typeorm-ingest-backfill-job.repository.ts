import type {
  BackfillJobRecord,
  CreateBackfillJob,
  IIngestBackfillJobRepository,
} from "@radar/shared";
import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";
import { IngestBackfillJobEntity } from "../../ingest/entities";
import { toBackfillJobRecord } from "./ingest-mappers";

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
