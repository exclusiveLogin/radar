import type { IPlaceCacheRepository } from "@radar/shared";
import type { DataSource } from "typeorm";
import { PlaceCacheEntity } from "../../events/entities/place-cache.entity";

export class TypeOrmPlaceCacheRepository implements IPlaceCacheRepository {
  constructor(private readonly dataSource: DataSource) {}

  async get(queryNorm: string): Promise<Record<string, unknown> | null> {
    const row = await this.dataSource.getRepository(PlaceCacheEntity).findOne({
      where: { queryNorm },
    });
    return row ? row.raw : null;
  }

  async put(queryNorm: string, value: Record<string, unknown>): Promise<void> {
    const repo = this.dataSource.getRepository(PlaceCacheEntity);
    const existing = await repo.findOne({ where: { queryNorm } });
    if (existing) {
      existing.provider = "dadata";
      existing.raw = value;
      existing.fetchedAt = new Date();
      await repo.save(existing);
      return;
    }
    await repo.save(
      repo.create({
        queryNorm,
        provider: "dadata",
        raw: value,
      }),
    );
  }
}
