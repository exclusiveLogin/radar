import {
  type IRegionRepository,
  type RegionRecord,
  parseKladrSubjectPrefix,
} from "@radar/shared";
import type { DataSource } from "typeorm";
import { Like } from "typeorm";
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
    centroidLat: row.centroidLat !== null ? Number(row.centroidLat) : undefined,
    centroidLon: row.centroidLon !== null ? Number(row.centroidLon) : undefined,
    bbox: row.bbox ?? undefined,
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

function normalizeRegionCodeAlias(code: string): string {
  const raw = code.trim().toUpperCase();
  if (!raw) return raw;
  if (raw === "UA-43") return "RU-CR";
  if (raw === "RU-SE") return "RU-SEV";
  return raw;
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
      centroidLat:
        record.centroidLat !== undefined ? record.centroidLat.toFixed(6) : null,
      centroidLon:
        record.centroidLon !== undefined ? record.centroidLon.toFixed(6) : null,
      bbox: record.bbox ?? null,
      sourceMeta: record.sourceMeta ?? {},
      lastSyncedAt: new Date(),
      lastSourceRevision: record.lastSourceRevision ?? null,
      isActive: true,
      frontRegion: record.frontRegion,
      borderRegion: record.borderRegion,
    });
  }

  /** Finds region by ISO/FIAS/name или по префиксу kladr_id (первые 2 цифры субъекта РФ). */
  async findByCode(code: string): Promise<RegionRecord | null> {
    const normalizedCode = normalizeRegionCodeAlias(code);
    const row = await this.repo().findOne({
      where: [
        { fiasId: normalizedCode },
        { iso: normalizedCode },
        { name: normalizedCode },
        { kladrId: normalizedCode },
      ],
    });
    if (row) {
      return toRegionRecord(row);
    }

    const kladrPrefix = parseKladrSubjectPrefix(normalizedCode);
    if (!kladrPrefix) {
      return null;
    }

    const byKladrPrefix = await this.repo().findOne({
      where: { kladrId: Like(`${kladrPrefix}%`) },
    });
    return byKladrPrefix ? toRegionRecord(byKladrPrefix) : null;
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
