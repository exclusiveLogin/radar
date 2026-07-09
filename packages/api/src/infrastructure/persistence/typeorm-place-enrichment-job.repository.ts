import {
  GEO_ENRICH_ELIGIBLE_KINDS,
  type IPlaceEnrichmentJobRepository,
  type PlaceEnrichmentJobRecord,
  type PlaceEnrichmentProvider,
} from "@radar/shared";
import type { DataSource } from "typeorm";
import { pgTimestampToIso, readTypeOrmQueryRows } from "./typeorm-query-rows";

type Row = {
  id: string;
  place_id: string;
  provider: PlaceEnrichmentProvider;
  status: PlaceEnrichmentJobRecord["status"];
  attempts: number;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
};

/** SSOT: kinds с rank ≥ city, без region — не тянем locality/settlement в pull-batch. */
const ENRICH_ELIGIBLE_KIND_SQL = GEO_ENRICH_ELIGIBLE_KINDS.map((k) => `'${k}'`).join(", ");

/** SSOT фильтр eligible places для geo enrich (pull batch). */
const ELIGIBLE_PLACE_WHERE = `
  p.is_active = true
  AND p.kind IN (${ENRICH_ELIGIBLE_KIND_SQL})
  AND p.centroid_lat IS NULL
  AND p.centroid_lon IS NULL
  AND (gf.centroid_lat IS NULL OR gf.id IS NULL)
  AND NOT EXISTS (
    SELECT 1 FROM job_geo_place_enrich j
    WHERE j.place_id = p.id
      AND j.provider = $1
      AND j.status = 'processing'
  )
  AND NOT EXISTS (
    SELECT 1 FROM job_geo_place_enrich j
    WHERE j.place_id = p.id
      AND j.provider = $1
      AND j.status IN ('done', 'failed')
  )
`;

/** ON CONFLICT: терминальные done/failed не трогаем, остальное → pending. */
const UPSERT_JOB_STATUS_SQL = `
  CASE
    WHEN job_geo_place_enrich.status IN ('done', 'failed')
    THEN job_geo_place_enrich.status
    ELSE 'pending'
  END
`;

export class TypeOrmPlaceEnrichmentJobRepository
implements IPlaceEnrichmentJobRepository {
  constructor(private readonly dataSource: DataSource) {}

  async enqueue(placeId: string, provider: PlaceEnrichmentProvider): Promise<void> {
    await this.dataSource.query(
      `
      INSERT INTO job_geo_place_enrich (place_id, provider, status, attempts, updated_at)
      VALUES ($1, $2, 'pending', 0, now())
      ON CONFLICT (place_id, provider) DO UPDATE
      SET status = ${UPSERT_JOB_STATUS_SQL},
          updated_at = now()
      `,
      [placeId, provider],
    );
  }

  async enqueueCatchUp(provider: PlaceEnrichmentProvider): Promise<{ enqueued: number }> {
    const rows = await this.dataSource.query(
      `
      INSERT INTO job_geo_place_enrich (place_id, provider, status, attempts, updated_at)
      SELECT p.id, $1, 'pending', 0, now()
      FROM places p
      LEFT JOIN geo_feature gf ON gf.id = p.geo_feature_id
      WHERE ${ELIGIBLE_PLACE_WHERE}
      ON CONFLICT (place_id, provider) DO UPDATE
      SET status = ${UPSERT_JOB_STATUS_SQL},
          updated_at = now()
      RETURNING id
      `,
      [provider],
    );
    const inserted = readTypeOrmQueryRows<{ id: string }>(rows);
    return { enqueued: inserted.length };
  }

  /** Pull batch: eligible places → upsert pending → claim processing. */
  async claimEligibleBatch(
    provider: PlaceEnrichmentProvider,
    limit: number,
  ): Promise<PlaceEnrichmentJobRecord[]> {
    // Legacy pending по ineligible kind — не claim'ить, пометить done.
    await this.dataSource.query(
      `
      UPDATE job_geo_place_enrich j
      SET status = 'done', updated_at = now()
      FROM places p
      WHERE j.place_id = p.id
        AND j.provider = $1
        AND j.status = 'pending'
        AND p.kind NOT IN (${ENRICH_ELIGIBLE_KIND_SQL})
      `,
      [provider],
    );

    // Шаг 1: upsert pending для eligible (отдельный statement).
    await this.dataSource.query(
      `
      INSERT INTO job_geo_place_enrich (place_id, provider, status, attempts, updated_at)
      SELECT p.id, $1, 'pending', 0, now()
      FROM places p
      LEFT JOIN geo_feature gf ON gf.id = p.geo_feature_id
      WHERE ${ELIGIBLE_PLACE_WHERE}
      ORDER BY p.updated_at ASC
      LIMIT $2
      ON CONFLICT (place_id, provider) DO UPDATE
      SET status = ${UPSERT_JOB_STATUS_SQL},
          updated_at = now()
      `,
      [provider, limit],
    );

    // Шаг 2: claim pending только для eligible places.
    const rows = readTypeOrmQueryRows<Row>(
      await this.dataSource.query(
        `
        UPDATE job_geo_place_enrich j
        SET status = 'processing', updated_at = now()
        WHERE j.id IN (
          SELECT j2.id
          FROM job_geo_place_enrich j2
          INNER JOIN places p ON p.id = j2.place_id
          LEFT JOIN geo_feature gf ON gf.id = p.geo_feature_id
          WHERE j2.provider = $1
            AND j2.status = 'pending'
            AND ${ELIGIBLE_PLACE_WHERE}
          ORDER BY j2.updated_at ASC
          LIMIT $2
          FOR UPDATE OF j2 SKIP LOCKED
        )
        RETURNING j.id, j.place_id, j.provider, j.status, j.attempts, j.last_error, j.created_at, j.updated_at
        `,
        [provider, limit],
      ),
    );
    return rows.map((row) => this.toRecord(row));
  }

  async claimBatch(
    provider: PlaceEnrichmentProvider,
    limit: number,
  ): Promise<PlaceEnrichmentJobRecord[]> {
    const rows = readTypeOrmQueryRows<Row>(
      await this.dataSource.query(
      `
      UPDATE job_geo_place_enrich SET status='processing', updated_at=now()
      WHERE id IN (
        SELECT id
        FROM job_geo_place_enrich
        WHERE provider = $1 AND status = 'pending'
        ORDER BY updated_at ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, place_id, provider, status, attempts, last_error, created_at, updated_at
      `,
      [provider, limit],
      ),
    );
    return rows.map((row) => this.toRecord(row));
  }

  async markDone(id: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE job_geo_place_enrich SET status='done', updated_at=now() WHERE id=$1`,
      [id],
    );
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE job_geo_place_enrich
       SET status='failed', attempts=attempts+1, last_error=$2, updated_at=now()
       WHERE id=$1`,
      [id, error.slice(0, 2000)],
    );
  }

  async releaseToPending(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const rows = readTypeOrmQueryRows<{ id: string }>(
      await this.dataSource.query(
        `UPDATE job_geo_place_enrich
         SET status='pending', last_error=NULL, updated_at=now()
         WHERE id = ANY($1::uuid[]) AND status = 'processing'
         RETURNING id`,
        [ids],
      ),
    );
    return rows.length;
  }

  async resetProcessingForProvider(provider: PlaceEnrichmentProvider): Promise<number> {
    const rows = readTypeOrmQueryRows<{ id: string }>(
      await this.dataSource.query(
        `UPDATE job_geo_place_enrich
         SET status='pending', last_error=NULL, updated_at=now()
         WHERE provider = $1 AND status = 'processing'
         RETURNING id`,
        [provider],
      ),
    );
    return rows.length;
  }

  async resetFailedForProvider(provider: PlaceEnrichmentProvider): Promise<number> {
    const rows = readTypeOrmQueryRows<{ id: string }>(
      await this.dataSource.query(
        `UPDATE job_geo_place_enrich
         SET status='pending', last_error=NULL, updated_at=now()
         WHERE provider = $1 AND status = 'failed'
         RETURNING id`,
        [provider],
      ),
    );
    return rows.length;
  }

  async countByStatus(
    provider: PlaceEnrichmentProvider,
  ): Promise<Record<PlaceEnrichmentJobRecord["status"], number>> {
    const rows = (await this.dataSource.query(
      `SELECT status, COUNT(*)::int AS count
       FROM job_geo_place_enrich
       WHERE provider = $1
       GROUP BY status`,
      [provider],
    )) as Array<{ status: PlaceEnrichmentJobRecord["status"]; count: number }>;
    const base: Record<PlaceEnrichmentJobRecord["status"], number> = {
      pending: 0,
      processing: 0,
      done: 0,
      failed: 0,
    };
    for (const row of rows) {
      base[row.status] = row.count;
    }
    return base;
  }

  async clearQueuedWork(provider?: PlaceEnrichmentProvider): Promise<number> {
    const rows = readTypeOrmQueryRows<{ id: string }>(
      await this.dataSource.query(
      provider
        ? `DELETE FROM job_geo_place_enrich
           WHERE provider = $1 AND status IN ('pending', 'processing')
           RETURNING id`
        : `DELETE FROM job_geo_place_enrich
           WHERE status IN ('pending', 'processing')
           RETURNING id`,
      provider ? [provider] : [],
      ),
    );
    return rows.length;
  }

  private toRecord(row: Row): PlaceEnrichmentJobRecord {
    return {
      id: row.id,
      placeId: row.place_id,
      provider: row.provider,
      status: row.status,
      attempts: row.attempts,
      lastError: row.last_error ?? undefined,
      createdAt: pgTimestampToIso(row.created_at),
      updatedAt: pgTimestampToIso(row.updated_at),
    };
  }
}
