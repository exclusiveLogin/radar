import type {
  CreateIngestProvider,
  IIngestProviderRepository,
  IngestProviderRecord,
  UpdateIngestProvider,
} from "@radar/shared";
import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";
import { IngestProviderEntity } from "../../ingest/entities";
import { toProviderRecord } from "./ingest-mappers";

export class TypeOrmIngestProviderRepository implements IIngestProviderRepository {
  constructor(private readonly dataSource: DataSource) {}

  async listActive(): Promise<IngestProviderRecord[]> {
    const rows = await this.dataSource.getRepository(IngestProviderEntity).find({
      // active + error: worker перезапускает ingest после сбоя duty (auto-retry).
      where: [{ status: "active" }, { status: "error" }],
      order: { key: "ASC" },
    });
    return rows.map(toProviderRecord);
  }

  async listAll(): Promise<IngestProviderRecord[]> {
    const rows = await this.dataSource.getRepository(IngestProviderEntity).find({
      order: { key: "ASC" },
    });
    return rows.map(toProviderRecord);
  }

  async findByKey(key: string): Promise<IngestProviderRecord | null> {
    const row = await this.dataSource.getRepository(IngestProviderEntity).findOne({ where: { key } });
    return row ? toProviderRecord(row) : null;
  }

  async findById(id: string): Promise<IngestProviderRecord | null> {
    const row = await this.dataSource.getRepository(IngestProviderEntity).findOne({ where: { id } });
    return row ? toProviderRecord(row) : null;
  }

  async create(input: CreateIngestProvider): Promise<IngestProviderRecord> {
    const repo = this.dataSource.getRepository(IngestProviderEntity);
    const row = repo.create({
      id: randomUUID(),
      key: input.key,
      title: input.title,
      adapterKind: input.adapterKind,
      status: "draft",
      adapterConfig: input.adapterConfig as Record<string, unknown>,
      credentialRefs: input.credentialRefs ?? {},
    });
    const saved = await repo.save(row);
    return toProviderRecord(saved);
  }

  async update(id: string, input: UpdateIngestProvider): Promise<IngestProviderRecord> {
    const repo = this.dataSource.getRepository(IngestProviderEntity);
    const row = await repo.findOneOrFail({ where: { id } });
    if (input.title !== undefined) row.title = input.title;
    if (input.status !== undefined) row.status = input.status;
    if (input.adapterConfig !== undefined) row.adapterConfig = input.adapterConfig as Record<string, unknown>;
    if (input.credentialRefs !== undefined) row.credentialRefs = input.credentialRefs;
    const saved = await repo.save(row);
    return toProviderRecord(saved);
  }

  async updateStatus(
    id: string,
    status: IngestProviderRecord["status"],
    lastError?: string | null,
  ): Promise<void> {
    const repo = this.dataSource.getRepository(IngestProviderEntity);
    await repo.update({ id }, { status, lastError: lastError ?? null });
  }

  async touchHeartbeat(id: string): Promise<void> {
    const repo = this.dataSource.getRepository(IngestProviderEntity);
    await repo.update({ id }, { lastHeartbeatAt: new Date() });
  }
}
