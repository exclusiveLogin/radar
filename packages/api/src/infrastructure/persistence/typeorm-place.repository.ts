import type { IPlaceRepository, PlaceRecord } from "@radar/shared";
import type { DataSource } from "typeorm";
import { PlaceEntity } from "../../geo/entities";

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export class TypeOrmPlaceRepository implements IPlaceRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findById(id: string): Promise<PlaceRecord | null> {
    const row = await this.dataSource.getRepository(PlaceEntity).findOne({ where: { id } });
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      regionId: row.regionId,
      parentPlaceId: row.parentPlaceId ?? undefined,
      kind: row.kind,
      name: row.name,
      nameWithType: row.nameWithType ?? undefined,
      fiasId: row.fiasId ?? undefined,
      kladrId: row.kladrId ?? undefined,
      oktmo: row.oktmo ?? undefined,
      geometryArtifactKey: row.geometryArtifactKey ?? undefined,
      sourceMeta: undefined,
      lastSourceRevision: row.lastSourceRevision ?? undefined,
    };
  }

  async findByFias(fiasId: string): Promise<PlaceRecord | null> {
    const row = await this.dataSource
      .getRepository(PlaceEntity)
      .findOne({ where: { fiasId } });
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      regionId: row.regionId,
      parentPlaceId: row.parentPlaceId ?? undefined,
      kind: row.kind,
      name: row.name,
      nameWithType: row.nameWithType ?? undefined,
      fiasId: row.fiasId ?? undefined,
      kladrId: row.kladrId ?? undefined,
      oktmo: row.oktmo ?? undefined,
      geometryArtifactKey: row.geometryArtifactKey ?? undefined,
      sourceMeta: undefined,
      lastSourceRevision: row.lastSourceRevision ?? undefined,
    };
  }

  async findByNameInRegion(
    name: string,
    regionId: string,
  ): Promise<PlaceRecord | null> {
    const normalized = normalizeName(name);
    const row = await this.dataSource.getRepository(PlaceEntity).findOne({
      where: {
        regionId,
        nameNormalized: normalized,
      },
    });
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      regionId: row.regionId,
      parentPlaceId: row.parentPlaceId ?? undefined,
      kind: row.kind,
      name: row.name,
      nameWithType: row.nameWithType ?? undefined,
      fiasId: row.fiasId ?? undefined,
      kladrId: row.kladrId ?? undefined,
      oktmo: row.oktmo ?? undefined,
      geometryArtifactKey: row.geometryArtifactKey ?? undefined,
      sourceMeta: undefined,
      lastSourceRevision: row.lastSourceRevision ?? undefined,
    };
  }

  async listActive(): Promise<PlaceRecord[]> {
    const rows = await this.dataSource.getRepository(PlaceEntity).find({
      where: { isActive: true },
    });
    return rows.map((row) => ({
      id: row.id,
      regionId: row.regionId,
      parentPlaceId: row.parentPlaceId ?? undefined,
      kind: row.kind,
      name: row.name,
      nameWithType: row.nameWithType ?? undefined,
      fiasId: row.fiasId ?? undefined,
      kladrId: row.kladrId ?? undefined,
      oktmo: row.oktmo ?? undefined,
      geometryArtifactKey: row.geometryArtifactKey ?? undefined,
      sourceMeta: undefined,
      lastSourceRevision: row.lastSourceRevision ?? undefined,
    }));
  }

  async upsertMany(places: PlaceRecord[]): Promise<void> {
    if (places.length === 0) return;
    const repo = this.dataSource.getRepository(PlaceEntity);
    for (const p of places) {
      const normalizedName = normalizeName(p.name);
      const existing = await repo.findOne({
        where: p.fiasId
          ? [{ fiasId: p.fiasId }, { regionId: p.regionId, kind: p.kind, nameNormalized: normalizedName }]
          : [{ regionId: p.regionId, kind: p.kind, nameNormalized: normalizedName }],
      });
      const row = repo.create({
        id: existing?.id ?? p.id,
        regionId: p.regionId,
        parentPlaceId: p.parentPlaceId ?? null,
        kind: p.kind,
        name: p.name,
        nameWithType: p.nameWithType ?? null,
        nameNormalized: normalizedName,
        fiasId: p.fiasId ?? null,
        kladrId: p.kladrId ?? null,
        oktmo: p.oktmo ?? null,
        geometryArtifactKey: p.geometryArtifactKey ?? null,
        lastSyncedAt: new Date(),
        lastSourceRevision: p.lastSourceRevision ?? null,
        isActive: true,
      });
      await repo.save(row);
    }
  }
}
