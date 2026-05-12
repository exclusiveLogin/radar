import { mergePlaceContribution } from "@radar/shared";
import type { IPlaceRepository, PlaceContribution, PlaceProvider, PlaceRecord } from "@radar/shared";
import type { DataSource } from "typeorm";
import { PlaceEntity } from "../../geo/entities";

/** Normalizes place name for deterministic search/upsert keys. */
function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function toPlaceProviders(value: unknown[]): PlaceProvider[] {
  return value.filter(
    (provider): provider is PlaceProvider =>
      provider === "catalog" ||
      provider === "dadata" ||
      provider === "nominatim" ||
      provider === "llm" ||
      provider === "operator" ||
      provider === "system",
  );
}


export class TypeOrmPlaceRepository implements IPlaceRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Returns Place repository instance bound to current data source. */
  private repo() {
    return this.dataSource.getRepository(PlaceEntity);
  }

  /** Maps TypeORM place entity into domain place record. */
  private toRecord(row: PlaceEntity): PlaceRecord {
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
      centroidLat: row.centroidLat !== null ? Number(row.centroidLat) : undefined,
      centroidLon: row.centroidLon !== null ? Number(row.centroidLon) : undefined,
      bbox: row.bbox ?? undefined,
      sourceMeta: undefined,
      lastSourceRevision: row.lastSourceRevision ?? undefined,
      trustState: row.trustState,
      isTrusted: row.isTrusted,
      trustScore: row.trustScore !== null ? Number(row.trustScore) : undefined,
      trustUpdatedAt: row.trustUpdatedAt?.toISOString(),
      evidenceProviders: toPlaceProviders(row.evidenceProviders ?? []),
    };
  }

  /** Finds existing place row by FIAS or natural key in region. */
  private async findExistingPlace(
    place: PlaceRecord,
    normalizedName: string,
  ): Promise<PlaceEntity | null> {
    return this.repo().findOne({
      where: place.fiasId
        ? [{ fiasId: place.fiasId }, { regionId: place.regionId, kind: place.kind, nameNormalized: normalizedName }]
        : [{ regionId: place.regionId, kind: place.kind, nameNormalized: normalizedName }],
    });
  }

  /** Converts place record into TypeORM entity for upsert save. */
  private toEntity(
    place: PlaceRecord,
    normalizedName: string,
    existingId?: string,
  ): PlaceEntity {
    return this.repo().create({
      id: existingId ?? place.id,
      regionId: place.regionId,
      parentPlaceId: place.parentPlaceId ?? null,
      kind: place.kind,
      name: place.name,
      nameWithType: place.nameWithType ?? null,
      nameNormalized: normalizedName,
      fiasId: place.fiasId ?? null,
      kladrId: place.kladrId ?? null,
      oktmo: place.oktmo ?? null,
      geometryArtifactKey: place.geometryArtifactKey ?? null,
      centroidLat: place.centroidLat !== undefined ? place.centroidLat.toFixed(6) : null,
      centroidLon: place.centroidLon !== undefined ? place.centroidLon.toFixed(6) : null,
      bbox: place.bbox ?? null,
      lastSyncedAt: new Date(),
      lastSourceRevision: place.lastSourceRevision ?? null,
      trustState: place.trustState ?? "unverified",
      isTrusted: place.isTrusted ?? false,
      trustScore:
        place.trustScore !== undefined ? place.trustScore.toFixed(3) : null,
      trustUpdatedAt: place.trustUpdatedAt ? new Date(place.trustUpdatedAt) : null,
      evidenceProviders: place.evidenceProviders ?? [],
      isActive: true,
    });
  }

  /** Finds place by id. */
  async findById(id: string): Promise<PlaceRecord | null> {
    const row = await this.repo().findOne({ where: { id } });
    if (!row) {
      return null;
    }
    return this.toRecord(row);
  }

  /** Finds place by FIAS id. */
  async findByFias(fiasId: string): Promise<PlaceRecord | null> {
    const row = await this.repo().findOne({ where: { fiasId } });
    if (!row) {
      return null;
    }
    return this.toRecord(row);
  }

  /** Finds place by normalized name scoped to region. */
  async findByNameInRegion(
    name: string,
    regionId: string,
  ): Promise<PlaceRecord | null> {
    const normalized = normalizeName(name);
    const row = await this.repo().findOne({
      where: {
        regionId,
        nameNormalized: normalized,
      },
    });
    if (!row) {
      return null;
    }
    return this.toRecord(row);
  }

  /** Returns all active places as domain records. */
  async listActive(): Promise<PlaceRecord[]> {
    const rows = await this.repo().find({
      where: { isActive: true },
    });
    return rows.map((row) => this.toRecord(row));
  }

  /** Upserts batch of places with deterministic identity matching. */
  async upsertMany(places: PlaceRecord[]): Promise<void> {
    if (places.length === 0) return;
    for (const place of places) {
      const normalizedName = normalizeName(place.name);
      const existing = await this.findExistingPlace(place, normalizedName);
      await this.repo().save(this.toEntity(place, normalizedName, existing?.id));
    }
  }

  async mergeContribution(
    input: PlaceContribution,
  ): Promise<{ updated: PlaceRecord; appliedFields: string[] }> {
    return this.dataSource.transaction(async (manager) => {
      const txRepo = manager.getRepository(PlaceEntity);
      // Lock target row to preserve deterministic merge semantics under concurrency.
      const current = await txRepo
        .createQueryBuilder("place")
        .where("place.id = :id", { id: input.placeId })
        .setLock("pessimistic_write")
        .getOne();
      if (!current) {
        throw new Error(`Place not found for contribution merge: ${input.placeId}`);
      }

      const merged = mergePlaceContribution(this.toRecord(current), input);
      if (merged.appliedFields.length === 0) {
        return { updated: this.toRecord(current), appliedFields: [] };
      }

      const normalizedName = normalizeName(merged.next.name);
      await txRepo.save(this.toEntity(merged.next, normalizedName, current.id));
      return { updated: merged.next, appliedFields: merged.appliedFields };
    });
  }
}
