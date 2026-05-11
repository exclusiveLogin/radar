import { isDeepStrictEqual } from "node:util";
import type { IPlaceRepository, PlaceContribution, PlaceRecord } from "@radar/shared";
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

const TRUST_STATE_RANK: Record<NonNullable<PlaceRecord["trustState"]>, number> = {
  rejected: 0,
  unverified: 1,
  partially_verified: 2,
  verified: 3,
};

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function tryApplyField<T>(params: {
  incoming: T | null | undefined;
  existing: T | null | undefined;
  incomingNotWorse: boolean;
  apply: (value: T) => void;
}): boolean {
  const { incoming, existing, incomingNotWorse, apply } = params;
  if (incoming === undefined || incoming === null) return false;
  if (!incomingNotWorse && hasValue(existing)) return false;
  if (isDeepStrictEqual(existing, incoming)) return false;
  apply(incoming);
  return true;
}

function monotonicTrustState(
  current: PlaceRecord["trustState"],
  incoming: NonNullable<PlaceRecord["trustState"]>,
): NonNullable<PlaceRecord["trustState"]> {
  if (!current) return incoming;
  return TRUST_STATE_RANK[incoming] >= TRUST_STATE_RANK[current] ? incoming : current;
}

function mergeContributionRecord(
  current: PlaceRecord,
  contribution: PlaceContribution,
): { next: PlaceRecord; appliedFields: string[] } {
  const next: PlaceRecord = { ...current };
  const appliedFields: string[] = [];
  const incomingNotWorse = contribution.trustScore >= (current.trustScore ?? 0);

  if (
    tryApplyField({
      incoming: contribution.fields.name,
      existing: next.name,
      incomingNotWorse,
      apply: (value) => {
        next.name = value;
      },
    })
  ) appliedFields.push("name");
  if (
    tryApplyField({
      incoming: contribution.fields.nameWithType,
      existing: next.nameWithType,
      incomingNotWorse,
      apply: (value) => {
        next.nameWithType = value;
      },
    })
  ) appliedFields.push("nameWithType");
  if (
    tryApplyField({
      incoming: contribution.fields.kind,
      existing: next.kind,
      incomingNotWorse,
      apply: (value) => {
        next.kind = value;
      },
    })
  ) appliedFields.push("kind");
  if (
    tryApplyField({
      incoming: contribution.fields.parentPlaceId,
      existing: next.parentPlaceId,
      incomingNotWorse,
      apply: (value) => {
        next.parentPlaceId = value;
      },
    })
  ) appliedFields.push("parentPlaceId");
  if (
    tryApplyField({
      incoming: contribution.fields.fiasId,
      existing: next.fiasId,
      incomingNotWorse,
      apply: (value) => {
        next.fiasId = value;
      },
    })
  ) appliedFields.push("fiasId");
  if (
    tryApplyField({
      incoming: contribution.fields.kladrId,
      existing: next.kladrId,
      incomingNotWorse,
      apply: (value) => {
        next.kladrId = value;
      },
    })
  ) appliedFields.push("kladrId");
  if (
    tryApplyField({
      incoming: contribution.fields.oktmo,
      existing: next.oktmo,
      incomingNotWorse,
      apply: (value) => {
        next.oktmo = value;
      },
    })
  ) appliedFields.push("oktmo");
  if (
    tryApplyField({
      incoming: contribution.fields.geometryArtifactKey,
      existing: next.geometryArtifactKey,
      incomingNotWorse,
      apply: (value) => {
        next.geometryArtifactKey = value;
      },
    })
  ) appliedFields.push("geometryArtifactKey");
  if (
    tryApplyField({
      incoming: contribution.fields.centroidLat,
      existing: next.centroidLat,
      incomingNotWorse,
      apply: (value) => {
        next.centroidLat = value;
      },
    })
  ) appliedFields.push("centroidLat");
  if (
    tryApplyField({
      incoming: contribution.fields.centroidLon,
      existing: next.centroidLon,
      incomingNotWorse,
      apply: (value) => {
        next.centroidLon = value;
      },
    })
  ) appliedFields.push("centroidLon");
  if (
    tryApplyField({
      incoming: contribution.fields.bbox,
      existing: next.bbox,
      incomingNotWorse,
      apply: (value) => {
        next.bbox = value;
      },
    })
  ) appliedFields.push("bbox");

  const mergedTrustState = monotonicTrustState(next.trustState, contribution.trustState);
  if (mergedTrustState !== next.trustState) {
    next.trustState = mergedTrustState;
    appliedFields.push("trustState");
  }

  const mergedIsTrusted = Boolean(next.isTrusted) || contribution.isTrusted;
  if (mergedIsTrusted !== next.isTrusted) {
    next.isTrusted = mergedIsTrusted;
    appliedFields.push("isTrusted");
  }

  const mergedTrustScore = Math.max(next.trustScore ?? 0, contribution.trustScore);
  if (mergedTrustScore !== next.trustScore) {
    next.trustScore = mergedTrustScore;
    appliedFields.push("trustScore");
  }

  const mergedProviders = [...new Set([...(next.evidenceProviders ?? []), contribution.provider])];
  if (!isDeepStrictEqual(mergedProviders, next.evidenceProviders ?? [])) {
    next.evidenceProviders = mergedProviders;
    appliedFields.push("evidenceProviders");
  }

  if (appliedFields.length > 0) {
    next.trustUpdatedAt = new Date().toISOString();
    appliedFields.push("trustUpdatedAt");
  }

  return { next, appliedFields };
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
      evidenceProviders:
        row.evidenceProviders?.filter(
          (provider): provider is "catalog" | "dadata" | "nominatim" | "llm" | "operator" | "system" =>
            typeof provider === "string",
        ) ?? [],
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
      const current = await txRepo
        .createQueryBuilder("place")
        .where("place.id = :id", { id: input.placeId })
        .setLock("pessimistic_write")
        .getOne();
      if (!current) {
        throw new Error(`Place not found for contribution merge: ${input.placeId}`);
      }

      const merged = mergeContributionRecord(this.toRecord(current), input);
      if (merged.appliedFields.length === 0) {
        return { updated: this.toRecord(current), appliedFields: [] };
      }

      const normalizedName = normalizeName(merged.next.name);
      await txRepo.save(this.toEntity(merged.next, normalizedName, current.id));
      return { updated: merged.next, appliedFields: merged.appliedFields };
    });
  }
}
