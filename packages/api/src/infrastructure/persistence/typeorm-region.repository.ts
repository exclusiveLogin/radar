import type { IRegionRepository, RegionRecord } from "@radar/shared";
import type { DataSource } from "typeorm";
import { RegionEntity } from "../../geo/entities";

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
      kladrId: row.kladrId ?? undefined,
      iso: row.iso ?? undefined,
      name: row.name,
      nameWithType: row.nameWithType ?? undefined,
      shortName: row.shortName ?? undefined,
      federalDistrict: row.federalDistrict ?? undefined,
      geometryArtifactKey: row.geometryArtifactKey ?? undefined,
      sourceMeta: row.sourceMeta ?? undefined,
      lastSourceRevision: row.lastSourceRevision ?? undefined,
      frontRegion: row.frontRegion,
      borderRegion: row.borderRegion,
    };
  }

  async listActive(): Promise<RegionRecord[]> {
    const rows = await this.dataSource.getRepository(RegionEntity).find({
      where: { isActive: true },
    });
    return rows.map((row) => ({
      id: row.id,
      code: row.fiasId ?? row.iso ?? row.name,
      fiasId: row.fiasId ?? undefined,
      kladrId: row.kladrId ?? undefined,
      iso: row.iso ?? undefined,
      name: row.name,
      nameWithType: row.nameWithType ?? undefined,
      shortName: row.shortName ?? undefined,
      federalDistrict: row.federalDistrict ?? undefined,
      geometryArtifactKey: row.geometryArtifactKey ?? undefined,
      sourceMeta: row.sourceMeta ?? undefined,
      lastSourceRevision: row.lastSourceRevision ?? undefined,
      frontRegion: row.frontRegion,
      borderRegion: row.borderRegion,
    }));
  }

  async upsertMany(regions: RegionRecord[]): Promise<void> {
    if (regions.length === 0) return;
    const repo = this.dataSource.getRepository(RegionEntity);
    for (const r of regions) {
      const existing = await repo.findOne({
        where: r.fiasId
          ? [{ fiasId: r.fiasId }, { iso: r.iso ?? r.code }, { name: r.name }]
          : [{ iso: r.iso ?? r.code }, { name: r.name }],
      });
      const row = repo.create({
        id: existing?.id ?? r.id,
        fiasId: r.fiasId ?? null,
        kladrId: r.kladrId ?? null,
        iso: r.iso ?? r.code ?? null,
        name: r.name,
        nameWithType: r.nameWithType ?? null,
        shortName: r.shortName ?? null,
        federalDistrict: r.federalDistrict ?? null,
        geometryArtifactKey: r.geometryArtifactKey ?? null,
        sourceMeta: r.sourceMeta ?? {},
        lastSyncedAt: new Date(),
        lastSourceRevision: r.lastSourceRevision ?? null,
        isActive: true,
        frontRegion: r.frontRegion,
        borderRegion: r.borderRegion,
      });
      await repo.save(row);
    }
  }
}
