import type { ISyncAuditRepository } from "@radar/shared";
import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";
import { GeoSyncLogEntity } from "../../geo/entities/geo-sync-log.entity";

export class TypeOrmSyncAuditRepository implements ISyncAuditRepository {
  constructor(private readonly dataSource: DataSource) {}

  async start(payload: Record<string, unknown>): Promise<{ id: string }> {
    const id = randomUUID();
    const repo = this.dataSource.getRepository(GeoSyncLogEntity);
    await repo.save(
      repo.create({
      id,
      target: String(payload.target ?? "all") as GeoSyncLogEntity["target"],
      sourceId: payload.sourceId ? String(payload.sourceId) : null,
      sourceRevision: payload.sourceRevision ? String(payload.sourceRevision) : null,
      status: "running",
      counts: {},
      diffSample: null,
      errors: null,
      }),
    );
    return { id };
  }

  async finish(id: string, payload: Record<string, unknown>): Promise<void> {
    const repo = this.dataSource.getRepository(GeoSyncLogEntity);
    const row = await repo.findOne({ where: { id } });
    if (!row) {
      return;
    }
    row.finishedAt = new Date();
    row.status = String(payload.status ?? "ok") as GeoSyncLogEntity["status"];
    row.counts = (payload.counts as Record<string, unknown> | undefined) ?? {};
    row.diffSample =
      (payload.diffSample as Record<string, unknown> | undefined) ?? null;
    row.errors = (payload.errors as Record<string, unknown> | undefined) ?? null;
    await repo.save(row);
  }
}
