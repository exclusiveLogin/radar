import type { IPlaceAliasRepository, PlaceAliasRecord } from "@radar/shared";
import type { DataSource } from "typeorm";
import { PlaceAliasEntity } from "../../geo/entities/place-alias.entity";

export class TypeOrmPlaceAliasRepository implements IPlaceAliasRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findByAlias(aliasNormalized: string): Promise<PlaceAliasRecord[]> {
    const rows = await this.dataSource.getRepository(PlaceAliasEntity).find({
      where: { aliasNormalized, isActive: true },
    });
    return rows.map((r) => ({
      id: r.id,
      alias: r.alias,
      aliasNormalized: r.aliasNormalized,
      targetKind: r.targetKind,
      regionId: r.regionId ?? undefined,
      placeId: r.placeId ?? undefined,
    }));
  }

  async upsertMany(aliases: PlaceAliasRecord[]): Promise<void> {
    if (aliases.length === 0) return;
    const repo = this.dataSource.getRepository(PlaceAliasEntity);
    await repo.upsert(
      aliases.map((a) => ({
        id: a.id,
        alias: a.alias,
        aliasNormalized: a.aliasNormalized,
        targetKind: a.targetKind,
        regionId: a.regionId ?? null,
        placeId: a.placeId ?? null,
      })),
      ["id"],
    );
  }
}
