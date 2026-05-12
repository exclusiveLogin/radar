import type { IRegionRepository, RegionRecord } from "@radar/shared";
import type { DataSource } from "typeorm";
import { RegionEntity } from "../../geo/entities";

/** Maps TypeORM region entity into domain-level region record. */
function toRegionRecord(row: RegionEntity): RegionRecord {
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

function toRegionIdentityWhere(record: RegionRecord) {
  const code = record.iso ?? record.code;
  return record.fiasId
    ? [{ fiasId: record.fiasId }, { iso: code }, { name: record.name }]
    : [{ iso: code }, { name: record.name }];
}

export class TypeOrmRegionRepository implements IRegionRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Returns Region repository instance bound to current data source. */
  private repo() {
    return this.dataSource.getRepository(RegionEntity);
  }

  /** Finds existing persisted region that matches incoming record identity. */
  private async findExistingRegion(
    record: RegionRecord,
  ): Promise<RegionEntity | null> {
    return this.repo().findOne({
      where: toRegionIdentityWhere(record),
    });
  }

  /** Converts region record into TypeORM entity for upsert save. */
  private toEntity(record: RegionRecord, existingId?: string): RegionEntity {
    return this.repo().create({
      id: existingId ?? record.id,
      fiasId: record.fiasId ?? null,
      kladrId: record.kladrId ?? null,
      iso: record.iso ?? record.code ?? null,
      name: record.name,
      nameWithType: record.nameWithType ?? null,
      shortName: record.shortName ?? null,
      federalDistrict: record.federalDistrict ?? null,
      geometryArtifactKey: record.geometryArtifactKey ?? null,
      sourceMeta: record.sourceMeta ?? {},
      lastSyncedAt: new Date(),
      lastSourceRevision: record.lastSourceRevision ?? null,
      isActive: true,
      frontRegion: record.frontRegion,
      borderRegion: record.borderRegion,
    });
  }

  /** Finds region by business code aliases (FIAS/ISO/name). */
  async findByCode(code: string): Promise<RegionRecord | null> {
    const row = await this.repo().findOne({
      where: [{ fiasId: code }, { iso: code }, { name: code }],
    });
    if (!row) {
      return null;
    }
    return toRegionRecord(row);
  }

  /** Returns all active regions as domain records. */
  async listActive(): Promise<RegionRecord[]> {
    const rows = await this.repo().find({
      where: { isActive: true },
    });
    return rows.map(toRegionRecord);
  }

  /** Upserts batch of regions one by one with identity matching. */
  async upsertMany(regions: RegionRecord[]): Promise<void> {
    if (regions.length === 0) return;
    for (const region of regions) {
      const existing = await this.findExistingRegion(region);
      await this.repo().save(this.toEntity(region, existing?.id));
    }
  }
}
