import type { IRegionRepository, RegionRecord } from "@radar/shared";
import type { DataSource } from "typeorm";
import { RegionEntity } from "../../geo/entities/region.entity";

export class TypeOrmRegionRepository implements IRegionRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findByCode(code: string): Promise<RegionRecord | null> {
    const row = await this.dataSource.getRepository(RegionEntity).findOne({
      where: [{ fiasId: code }, { iso: code }, { name: code }],
    });
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      code: row.fiasId ?? row.iso ?? row.name,
      fiasId: row.fiasId ?? undefined,
      name: row.name,
      frontRegion: row.frontRegion,
      borderRegion: row.borderRegion,
    };
  }

  async upsertMany(regions: RegionRecord[]): Promise<void> {
    if (regions.length === 0) return;
    const repo = this.dataSource.getRepository(RegionEntity);
    await repo.upsert(
      regions.map((r) => ({
        id: r.id,
        fiasId: r.fiasId ?? null,
        iso: r.code,
        name: r.name,
        frontRegion: r.frontRegion,
        borderRegion: r.borderRegion,
      })),
      ["id"],
    );
  }
}
