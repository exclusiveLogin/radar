import type {
  IPlaceStatusRepository,
  PlaceStatusActiveRecord,
} from "@radar/shared";
import type { DataSource } from "typeorm";
import { PlaceStatusActiveEntity } from "../../events/entities";

export class TypeOrmPlaceStatusRepository implements IPlaceStatusRepository {
  constructor(private readonly dataSource: DataSource) {}async upsertActive(input: PlaceStatusActiveRecord): Promise<void> {
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
  }async deactivate(
    placeId: string,
    statusCode: string,
    _atIso: string,
  ): Promise<void> {
    await this.dataSource
      .getRepository(PlaceStatusActiveEntity)
      .delete({ placeId, statusCode });
  }async listActive(placeId: string): Promise<PlaceStatusActiveRecord[]> {
    const rows = await this.dataSource.getRepository(PlaceStatusActiveEntity).find({
      where: { placeId },
      order: { updatedAt: "DESC" },
    });
    return rows.map((row) => ({
      placeId: row.placeId,
      statusCode: row.statusCode,
      source: row.source,
      startedAt: row.startedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      meta: row.meta,
    }));
  }
}
