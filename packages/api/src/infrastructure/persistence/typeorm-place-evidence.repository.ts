import type { IPlaceEvidenceRepository, PlaceEvidenceRecord } from "@radar/shared";
import type { DataSource } from "typeorm";
import { PlaceEvidenceEntity } from "../../events/entities";

export class TypeOrmPlaceEvidenceRepository implements IPlaceEvidenceRepository {
  constructor(private readonly dataSource: DataSource) {}

  private repo() {
    return this.dataSource.getRepository(PlaceEvidenceEntity);
  }

  private toRecord(row: PlaceEvidenceEntity): PlaceEvidenceRecord {
    return {
      id: row.id,
      placeId: row.placeId,
      provider: row.provider,
      action: row.action,
      confidence: row.confidence !== null ? Number(row.confidence) : undefined,
      payload: row.payload,
      traceId: row.traceId ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async append(record: PlaceEvidenceRecord): Promise<void> {
    await this.repo().save({
      id: record.id,
      placeId: record.placeId,
      provider: record.provider,
      action: record.action,
      confidence:
        record.confidence !== undefined ? record.confidence.toFixed(3) : null,
      payload: record.payload ?? {},
      traceId: record.traceId ?? null,
      createdAt: new Date(record.createdAt),
    });
  }

  async listByPlace(placeId: string, limit: number): Promise<PlaceEvidenceRecord[]> {
    const rows = await this.repo().find({
      where: { placeId },
      order: { createdAt: "DESC" },
      take: limit,
    });
    return rows.map((row) => this.toRecord(row));
  }
}
