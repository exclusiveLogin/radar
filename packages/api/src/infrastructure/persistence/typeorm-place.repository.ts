import type { IPlaceRepository, PlaceRecord } from "@radar/shared";
import type { DataSource } from "typeorm";
import { PlaceEntity } from "../../geo/entities/place.entity";

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
      fiasId: row.fiasId ?? undefined,
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
      fiasId: row.fiasId ?? undefined,
    };
  }

  async findByNameInRegion(
    name: string,
    regionId: string,
  ): Promise<PlaceRecord | null> {
    const normalized = name.toLowerCase().trim();
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
      fiasId: row.fiasId ?? undefined,
    };
  }

  async upsertMany(places: PlaceRecord[]): Promise<void> {
    if (places.length === 0) return;
    const repo = this.dataSource.getRepository(PlaceEntity);
    await repo.upsert(
      places.map((p) => ({
        id: p.id,
        regionId: p.regionId,
        parentPlaceId: p.parentPlaceId ?? null,
        kind: p.kind,
        name: p.name,
        nameNormalized: p.name.toLowerCase().trim(),
        fiasId: p.fiasId ?? null,
      })),
      ["id"],
    );
  }
}
