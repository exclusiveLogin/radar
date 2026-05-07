import type { IPlaceAliasRepository, PlaceAliasRecord } from "@radar/shared";
import type { DataSource } from "typeorm";
import { PlaceAliasEntity } from "../../geo/entities";

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

  async upsertAlias(input: {
    targetKind: "region" | "place";
    regionId?: string;
    placeId?: string;
    alias: string;
    source: "auto" | "manual";
  }): Promise<void> {
    const repo = this.dataSource.getRepository(PlaceAliasEntity);
    const aliasNormalized = input.alias.toLowerCase().trim();
    const existing = await repo.findOne(
      input.targetKind === "region"
        ? {
            where: {
              targetKind: "region",
              regionId: input.regionId,
              aliasNormalized,
            },
          }
        : {
            where: {
              targetKind: "place",
              placeId: input.placeId,
              aliasNormalized,
            },
          },
    );
    if (existing) {
      if (!existing.isActive) {
        existing.isActive = true;
        existing.deprecatedAt = null;
      }
      existing.alias = input.alias;
      existing.source = input.source;
      await repo.save(existing);
      return;
    }
    await repo.save(
      repo.create({
        targetKind: input.targetKind,
        regionId: input.regionId ?? null,
        placeId: input.placeId ?? null,
        alias: input.alias,
        aliasNormalized,
        source: input.source,
      }),
    );
  }
}
