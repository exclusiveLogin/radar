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
