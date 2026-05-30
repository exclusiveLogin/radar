import { randomUUID } from "node:crypto";
import type {
  IPlaceStatusRepository,
  PlaceStatusActiveRecord,
} from "@radar/shared";
import type { DataSource } from "typeorm";
import { LessThan } from "typeorm";
import {
  PlaceStatusActiveEntity,
  PlaceStatusHistoryEntity,
} from "../../events/entities";

export class TypeOrmPlaceStatusRepository implements IPlaceStatusRepository {
  constructor(private readonly dataSource: DataSource) {}
async upsertActive(input: PlaceStatusActiveRecord): Promise<void> {
    const repo = this.dataSource.getRepository(PlaceStatusActiveEntity);
    const existing = await repo.findOne({
      where: { placeId: input.placeId, statusCode: input.statusCode },
    });
    if (existing) {
      existing.source = input.source;
      existing.updatedAt = new Date(input.updatedAt);
      existing.meta = input.meta ?? {};
      if (!existing.startedAt) {
        existing.startedAt = new Date(input.startedAt);
      }
      await repo.save(existing);
      return;
    }
    await repo.save(
      repo.create({
        placeId: input.placeId,
        statusCode: input.statusCode,
        source: input.source,
        startedAt: new Date(input.startedAt),
        updatedAt: new Date(input.updatedAt),
        meta: input.meta ?? {},
      }),
    );
    await this.appendHistory({
      placeId: input.placeId,
      statusCode: input.statusCode,
      source: input.source,
      action: "activate",
      eventAt: input.updatedAt,
      meta: input.meta,
    });
  }
  async deactivate(
    placeId: string,
    statusCode: string,
    atIso: string,
  ): Promise<void> {
    const repo = this.dataSource.getRepository(PlaceStatusActiveEntity);
    const existing = await repo.findOne({ where: { placeId, statusCode } });
    await repo.delete({ placeId, statusCode });
    if (existing) {
      await this.appendHistory({
        placeId,
        statusCode,
        source: existing.source,
        action: "deactivate",
        eventAt: atIso,
        meta: existing.meta,
      });
    }
  }

  /** Журнал смен для WS-поллера карты. */
  private async appendHistory(input: {
    placeId: string;
    statusCode: string;
    source: PlaceStatusActiveRecord["source"];
    action: "activate" | "deactivate";
    eventAt: string;
    meta?: Record<string, unknown>;
  }): Promise<void> {
    await this.dataSource.getRepository(PlaceStatusHistoryEntity).save({
      id: randomUUID(),
      placeId: input.placeId,
      statusCode: input.statusCode,
      action: input.action,
      source: input.source,
      eventAt: new Date(input.eventAt),
      meta: input.meta ?? {},
    });
  }
  async listActive(placeId: string): Promise<PlaceStatusActiveRecord[]> {
    const rows = await this.dataSource.getRepository(PlaceStatusActiveEntity).find({
      where: { placeId },
      order: { updatedAt: "DESC" },
    });
    return rows.map((row) => this.toRecord(row));
  }

  async listActiveByRegionId(regionId: string): Promise<PlaceStatusActiveRecord[]> {
    const rows = await this.dataSource
      .getRepository(PlaceStatusActiveEntity)
      .createQueryBuilder("psa")
      .innerJoin("psa.place", "place")
      .where("place.region_id = :regionId", { regionId })
      .orderBy("psa.updated_at", "ASC")
      .getMany();
    return rows.map((row) => this.toRecord(row));
  }

  async listAllActive(): Promise<PlaceStatusActiveRecord[]> {
    const rows = await this.dataSource.getRepository(PlaceStatusActiveEntity).find({
      order: { updatedAt: "ASC" },
    });
    return rows.map((row) => this.toRecord(row));
  }

  async listActiveUpdatedBefore(
    updatedBeforeIso: string,
  ): Promise<PlaceStatusActiveRecord[]> {
    const rows = await this.dataSource.getRepository(PlaceStatusActiveEntity).find({
      where: { updatedAt: LessThan(new Date(updatedBeforeIso)) },
      order: { updatedAt: "ASC" },
    });
    return rows.map((row) => this.toRecord(row));
  }

  private toRecord(row: PlaceStatusActiveEntity): PlaceStatusActiveRecord {
    return {
      placeId: row.placeId,
      statusCode: row.statusCode,
      source: row.source,
      startedAt: row.startedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      meta: row.meta,
    };
  }
}
