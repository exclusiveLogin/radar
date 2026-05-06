import type {
  IPlaceStatusHistoryRepository,
  PlaceStatusHistoryRecord,
} from "@radar/shared";
import type { DataSource } from "typeorm";
import { PlaceStatusHistoryEntity } from "../../events/entities/place-status-history.entity";

export class TypeOrmPlaceStatusHistoryRepository
  implements IPlaceStatusHistoryRepository
{
  constructor(private readonly dataSource: DataSource) {}

  async append(record: PlaceStatusHistoryRecord): Promise<void> {
    await this.dataSource.getRepository(PlaceStatusHistoryEntity).save({
      id: record.id,
      placeId: record.placeId,
      statusCode: record.statusCode,
      action: record.action,
      source: record.source,
      eventAt: new Date(record.eventAt),
      meta: record.meta ?? {},
    });
  }

  async listByPlace(
    placeId: string,
    limit: number,
  ): Promise<PlaceStatusHistoryRecord[]> {
    const rows = await this.dataSource.getRepository(PlaceStatusHistoryEntity).find({
      where: { placeId },
      order: { eventAt: "DESC" },
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      placeId: row.placeId,
      statusCode: row.statusCode,
      action: row.action,
      source: row.source,
      eventAt: row.eventAt.toISOString(),
      meta: row.meta,
    }));
  }
}
