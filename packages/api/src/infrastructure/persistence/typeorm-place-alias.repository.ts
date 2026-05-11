import type { IPlaceAliasRepository, PlaceAliasRecord } from "@radar/shared";
import type { DataSource } from "typeorm";
import { PlaceAliasEntity } from "../../geo/entities";

export class TypeOrmPlaceAliasRepository implements IPlaceAliasRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Returns PlaceAlias repository instance bound to current data source. */
  private repo() {
    return this.dataSource.getRepository(PlaceAliasEntity);
  }

  /** Maps TypeORM alias entity into domain alias record. */
  private toRecord(row: PlaceAliasEntity): PlaceAliasRecord {
    return {
      id: row.id,
      alias: row.alias,
      aliasNormalized: row.aliasNormalized,
      targetKind: row.targetKind,
      regionId: row.regionId ?? undefined,
      placeId: row.placeId ?? undefined,
      source: row.source,
    };
  }

  /** Finds existing alias row by target and normalized alias. */
  private async findExistingAlias(
    alias: PlaceAliasRecord,
  ): Promise<PlaceAliasEntity | null> {
    return this.repo().findOne({
      where:
        alias.targetKind === "region"
          ? {
              targetKind: "region",
              regionId: alias.regionId ?? undefined,
              aliasNormalized: alias.aliasNormalized,
            }
          : {
              targetKind: "place",
              placeId: alias.placeId ?? undefined,
              aliasNormalized: alias.aliasNormalized,
            },
    });
  }

  /** Finds active aliases by normalized alias value. */
  async findByAlias(aliasNormalized: string): Promise<PlaceAliasRecord[]> {
    const rows = await this.repo().find({
      where: { aliasNormalized, isActive: true },
    });
    return rows.map((row) => this.toRecord(row));
  }

  /** Returns all active aliases as domain records. */
  async listActive(): Promise<PlaceAliasRecord[]> {
    const rows = await this.repo().find({
      where: { isActive: true },
    });
    return rows.map((row) => this.toRecord(row));
  }

  /** Upserts batch of aliases with identity matching by target kind. */
  async upsertMany(aliases: PlaceAliasRecord[]): Promise<void> {
    if (aliases.length === 0) return;
    for (const alias of aliases) {
      const existing = await this.findExistingAlias(alias);
      await this.repo().save(
        this.repo().create({
          id: existing?.id ?? alias.id,
          alias: alias.alias,
          aliasNormalized: alias.aliasNormalized,
          targetKind: alias.targetKind,
          regionId: alias.regionId ?? null,
          placeId: alias.placeId ?? null,
          source: alias.source ?? "auto",
          isActive: true,
          deprecatedAt: null,
        }),
      );
    }
  }

  /** Upserts a single alias from external command/use-case. */
  async upsertAlias(input: {
    targetKind: "region" | "place";
    regionId?: string;
    placeId?: string;
    alias: string;
    source: "auto" | "manual";
  }): Promise<void> {
    const repo = this.repo();
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
