import type { IPlaceRepository, PlaceContribution, PlaceProvider, PlaceRecord } from "@radar/shared";
import { kindMeetsFloor, mergePlaceContribution, placeKindRank, placeStem, type FindByStemGlobalOptions, type PlaceScanEntry } from "@radar/shared";
import type { DataSource } from "typeorm";
import { PlaceEntity } from "../entities/geo";

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
      nameStem: row.nameStem || undefined,
      geoFeatureId: row.geoFeatureId ?? undefined,
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

  /** Finds existing place row по SSOT identity (shared/placeIdentity). */
  private async findExistingPlace(
    place: PlaceRecord,
    normalizedName: string,
  ): Promise<PlaceEntity | null> {
    if (place.fiasId) {
      const byFias = await this.repo().findOne({
        where: { fiasId: place.fiasId },
      });
      if (byFias) {
        return byFias;
      }
    }

    if (place.oktmo) {
      const byOktmoAndName = await this.repo().findOne({
        where: {
          regionId: place.regionId,
          oktmo: place.oktmo,
          nameNormalized: normalizedName,
        },
      });
      if (byOktmoAndName) {
        return byOktmoAndName;
      }
    }

    return this.repo().findOne({
      where: {
        regionId: place.regionId,
        kind: place.kind,
        nameNormalized: normalizedName,
      },
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
      nameStem: place.nameStem ?? placeStem(place.name),
      geoFeatureId: place.geoFeatureId ?? null,
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

  /** Субъект РФ как place(kind=region) для данного regions.id. */
  async findRegionPlaceByRegionId(regionId: string): Promise<PlaceRecord | null> {
    const row = await this.repo().findOne({
      where: { regionId, kind: "region", isActive: true },
    });
    return row ? this.toRecord(row) : null;
  }

  /** Finds place by FIAS id. */
  async findByFias(fiasId: string): Promise<PlaceRecord | null> {
    const row = await this.repo().findOne({ where: { fiasId } });
    if (!row) {
      return null;
    }
    return this.toRecord(row);
  }

  /** Finds place by ОКТМО в рамках субъекта (geometry link + catalog upsert). */
  async findByOktmoInRegion(
    regionId: string,
    oktmo: string,
  ): Promise<PlaceRecord | null> {
    const row = await this.repo().findOne({
      where: { regionId, oktmo, isActive: true },
    });
    return row ? this.toRecord(row) : null;
  }

  /** Finds place by normalized name scoped to region (legacy, по nameNormalized). */
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
    return row ? this.toRecord(row) : null;
  }

  /**
   * Поиск place по name_stem + region_id — основной метод после рефактора.
   * При коллизии (≥2 совпадений по стему) — предпочитает kind=city_district
   * если в аргументе указан cityAnchor.
   */
  async findByStemInRegion(
    stem: string,
    regionId: string,
    preferKind?: PlaceRecord["kind"],
  ): Promise<PlaceRecord | null> {
    const rows = await this.repo().find({
      where: { regionId, nameStem: stem, isActive: true },
    });
    if (rows.length === 0) return null;
    if (rows.length === 1) return this.toRecord(rows[0]);

    // При коллизии: предпочитаем preferKind (city_district при городском якоре)
    if (preferKind) {
      const preferred = rows.find((r) => r.kind === preferKind);
      if (preferred) return this.toRecord(preferred);
    }
    // Иначе: catalog (isTrusted) > operational
    const trusted = rows.find((r) => r.isTrusted);
    return this.toRecord(trusted ?? rows[0]);
  }

  async findByStemGlobal(
    stem: string,
    opts: FindByStemGlobalOptions,
  ): Promise<PlaceRecord[]> {
    const qb = this.repo()
      .createQueryBuilder("p")
      .where("p.is_active = true")
      .andWhere("p.name_stem = :stem", { stem });
    if (opts.regionId) {
      qb.andWhere("p.region_id = :regionId", { regionId: opts.regionId });
    }
    const rows = await qb.getMany();
    let records = rows
      .map((row) => this.toRecord(row))
      .filter((row) => kindMeetsFloor(row.kind, opts.minKind));
    if (opts.maxKind) {
      records = records.filter((row) => placeKindRank(row.kind) <= placeKindRank(opts.maxKind!));
    }
    if (opts.preferKind) {
      const preferred = records.filter((row) => row.kind === opts.preferKind);
      if (preferred.length > 0) return preferred;
    }
    return records;
  }

  async findRegionPlaceByIso(iso: string): Promise<PlaceRecord | null> {
    const row = await this.repo()
      .createQueryBuilder("p")
      .innerJoin("regions", "r", "r.id = p.region_id")
      .where("p.kind = :kind", { kind: "region" })
      .andWhere("p.is_active = true")
      .andWhere("r.iso = :iso", { iso })
      .getOne();
    return row ? this.toRecord(row) : null;
  }

  async listScanEntries(): Promise<PlaceScanEntry[]> {
    const rows: Array<{
      id: string;
      region_id: string;
      kind: PlaceRecord["kind"];
      name: string;
      name_stem: string;
      name_with_type: string | null;
      centroid_lat: string | null;
      centroid_lon: string | null;
      region_code: string;
      short_name: string | null;
    }> = await this.dataSource.query(
      `SELECT p.id, p.region_id, p.kind, p.name, p.name_stem, p.name_with_type,
              p.centroid_lat, p.centroid_lon,
              COALESCE(r.iso, r.fias_id, r.name) AS region_code,
              r.short_name
       FROM places p
       INNER JOIN regions r ON r.id = p.region_id
       WHERE p.is_active = true`,
    );
    return rows.map((row) => ({
      placeId: row.id,
      regionId: row.region_id,
      // Канонический regionCode для scan scope — как toRegionRecord().code / canonicalRegionCode().
      regionIso: row.region_code,
      kind: row.kind,
      name: row.name,
      nameStem: row.name_stem,
      regionShortName:
        row.kind === "region" && row.short_name ? row.short_name : undefined,
      nameWithType: row.name_with_type ?? undefined,
      centroidLat: row.centroid_lat != null ? Number(row.centroid_lat) : undefined,
      centroidLon: row.centroid_lon != null ? Number(row.centroid_lon) : undefined,
    }));
  }

  /** Returns all active places as domain records. */
  async listActive(): Promise<PlaceRecord[]> {
    const rows = await this.repo().find({
      where: { isActive: true },
    });
    return rows.map((row) => this.toRecord(row));
  }

  /**
   * При catalog upsert сохраняем enrich/geo поля существующей строки.
   * Повторный import не сбрасывает trust и geo_feature_id.
   */
  private preserveExistingEnrichment(
    entity: PlaceEntity,
    existing: PlaceEntity,
  ): PlaceEntity {
    if (existing.geoFeatureId && !entity.geoFeatureId) {
      entity.geoFeatureId = existing.geoFeatureId;
    }

    const hasIngestEvidence = (existing.evidenceProviders ?? []).some(
      (provider) => provider !== "catalog",
    );
    if (hasIngestEvidence) {
      entity.trustState = existing.trustState;
      entity.isTrusted = existing.isTrusted;
      entity.trustScore = existing.trustScore;
      entity.evidenceProviders = existing.evidenceProviders;
      entity.trustUpdatedAt = existing.trustUpdatedAt;
    }

    return entity;
  }

  /** Upserts batch of places with deterministic identity matching. */
  async upsertMany(places: PlaceRecord[]): Promise<void> {
    if (places.length === 0) return;
    for (const place of places) {
      const normalizedName = normalizeName(place.name);
      const existing = await this.findExistingPlace(place, normalizedName);
      let entity = this.toEntity(place, normalizedName, existing?.id);
      if (existing) {
        entity = this.preserveExistingEnrichment(entity, existing);
      }
      await this.repo().save(entity);
    }
  }

  /**
   * TX + pessimistic lock; доменные правила — mergePlaceContribution в @radar/shared.
   * @see ../../../../../docs/domain/unit-of-work-and-transactions.md
   * @see ../../../../../docs/domain/contexts/geo-place.md
   */
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
