import type { IPlaceAliasRepository, PlaceAliasRecord } from "@radar/shared";
import type { DataSource } from "typeorm";
import { PlaceAliasEntity } from "../../geo/entities";

export class TypeOrmPlaceAliasRepository implements IPlaceAliasRepository {
  constructor(private readonly dataSource: DataSource) {}

  private repo() {
    return this.dataSource.getRepository(PlaceAliasEntity);
  }

  private toRecord(row: PlaceAliasEntity): PlaceAliasRecord | null {
    if (!row.placeId) return null;
    return {
      id: row.id,
      placeId: row.placeId,
      alias: row.alias,
      aliasNormalized: row.aliasNormalized,
      source: row.source,
    };
  }

  private normalizeAlias(value: string): string {
    return value
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  async findByAlias(aliasNormalized: string): Promise<PlaceAliasRecord[]> {
    const rows = await this.repo().find({
      where: { aliasNormalized, isActive: true },
    });
    return rows
      .map((row) => this.toRecord(row))
      .filter((row): row is PlaceAliasRecord => row !== null);
  }

  async listActive(): Promise<PlaceAliasRecord[]> {
    const rows = await this.repo().find({ where: { isActive: true } });
    return rows
      .map((row) => this.toRecord(row))
      .filter((row): row is PlaceAliasRecord => row !== null);
  }

  async upsertMany(aliases: PlaceAliasRecord[]): Promise<void> {
    for (const alias of aliases) {
      await this.upsertAlias({
        placeId: alias.placeId,
        alias: alias.alias,
        source: alias.source ?? "auto",
      });
    }
  }

  async upsertAlias(input: {
    placeId: string;
    alias: string;
    source: "auto" | "manual";
  }): Promise<void> {
    const repo = this.repo();
    const aliasNormalized = this.normalizeAlias(input.alias);
    const existing = await repo.findOne({
      where: { placeId: input.placeId, aliasNormalized, isActive: true },
    });
    if (existing) {
      existing.alias = input.alias;
      existing.source = input.source;
      await repo.save(existing);
      return;
    }
    await repo.save(
      repo.create({
        targetKind: "place",
        regionId: null,
        placeId: input.placeId,
        alias: input.alias,
        aliasNormalized,
        source: input.source,
        isActive: true,
        deprecatedAt: null,
      }),
    );
  }
}
