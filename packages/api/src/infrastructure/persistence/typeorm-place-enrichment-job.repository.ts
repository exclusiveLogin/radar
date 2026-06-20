import type {
  IPlaceEnrichmentJobRepository,
  PlaceEnrichmentJobRecord,
  PlaceEnrichmentProvider,
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

/** SSOT фильтр eligible places для geo enrich (pull batch). */
const ELIGIBLE_PLACE_WHERE = `
  p.is_active = true
  AND p.kind <> 'region'
  AND p.centroid_lat IS NULL
  AND p.centroid_lon IS NULL
  AND (gf.centroid_lat IS NULL OR gf.id IS NULL)
  AND NOT EXISTS (
    SELECT 1 FROM place_enrichment_jobs j
    WHERE j.place_id = p.id
      AND j.provider = $1
      AND j.status = 'processing'
  )
  AND NOT EXISTS (
    SELECT 1 FROM place_enrichment_jobs j
    WHERE j.place_id = p.id
      AND j.provider = $1
      AND j.status = 'done'
      AND p.centroid_lat IS NOT NULL
      AND p.centroid_lon IS NOT NULL
  )
`;

export class TypeOrmPlaceEnrichmentJobRepository
implements IPlaceEnrichmentJobRepository {
  constructor(private readonly dataSource: DataSource) {}

  async enqueue(placeId: string, provider: PlaceEnrichmentProvider): Promise<void> {
    await this.dataSource.query(
      `
      INSERT INTO place_enrichment_jobs (place_id, provider, status, attempts, updated_at)
      VALUES ($1, $2, 'pending', 0, now())
      ON CONFLICT (place_id, provider) DO UPDATE
      SET status = CASE
            WHEN place_enrichment_jobs.status = 'done' THEN place_enrichment_jobs.status
            ELSE 'pending'
          END,
          updated_at = now()
      `,
      [placeId, provider],
    );
  }

  async enqueueCatchUp(provider: PlaceEnrichmentProvider): Promise<{ enqueued: number }> {
    const rows = await this.dataSource.query(
      `
      INSERT INTO place_enrichment_jobs (place_id, provider, status, attempts, updated_at)
      SELECT p.id, $1, 'pending', 0, now()
      FROM places p
      LEFT JOIN geo_feature gf ON gf.id = p.geo_feature_id
      WHERE ${ELIGIBLE_PLACE_WHERE}
      ON CONFLICT (place_id, provider) DO UPDATE
      SET status = CASE
            WHEN place_enrichment_jobs.status = 'done'
              AND EXISTS (
                SELECT 1 FROM places pp
                WHERE pp.id = place_enrichment_jobs.place_id
                  AND pp.centroid_lat IS NOT NULL
                  AND pp.centroid_lon IS NOT NULL
              )
            THEN place_enrichment_jobs.status
            ELSE 'pending'
          END,
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
    const rows = readTypeOrmQueryRows<Row>(
      await this.dataSource.query(
        `
        WITH eligible AS (
          SELECT p.id AS place_id
          FROM places p
          LEFT JOIN geo_feature gf ON gf.id = p.geo_feature_id
          WHERE ${ELIGIBLE_PLACE_WHERE}
          ORDER BY p.updated_at ASC
          LIMIT $2
        ),
        upserted AS (
          INSERT INTO place_enrichment_jobs (place_id, provider, status, attempts, updated_at)
          SELECT place_id, $1, 'pending', 0, now()
          FROM eligible
          ON CONFLICT (place_id, provider) DO UPDATE
          SET status = CASE
                WHEN place_enrichment_jobs.status = 'done'
                  AND EXISTS (
                    SELECT 1 FROM places pp
                    WHERE pp.id = place_enrichment_jobs.place_id
                      AND pp.centroid_lat IS NOT NULL
                      AND pp.centroid_lon IS NOT NULL
                  )
                THEN place_enrichment_jobs.status
                ELSE 'pending'
              END,
              updated_at = now()
          RETURNING id
        )
        UPDATE place_enrichment_jobs j
        SET status = 'processing', updated_at = now()
        FROM upserted u
        WHERE j.id = u.id AND j.status = 'pending'
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
      UPDATE place_enrichment_jobs SET status='processing', updated_at=now()
      WHERE id IN (
        SELECT id
        FROM place_enrichment_jobs
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
      `UPDATE place_enrichment_jobs SET status='done', updated_at=now() WHERE id=$1`,
      [id],
    );
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE place_enrichment_jobs
       SET status='failed', attempts=attempts+1, last_error=$2, updated_at=now()
       WHERE id=$1`,
      [id, error.slice(0, 2000)],
    );
  }

  async releaseToPending(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const rows = readTypeOrmQueryRows<{ id: string }>(
      await this.dataSource.query(
        `UPDATE place_enrichment_jobs
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
        `UPDATE place_enrichment_jobs
         SET status='pending', last_error=NULL, updated_at=now()
         WHERE provider = $1 AND status = 'processing'
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
       FROM place_enrichment_jobs
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
        ? `DELETE FROM place_enrichment_jobs
           WHERE provider = $1 AND status IN ('pending', 'processing')
           RETURNING id`
        : `DELETE FROM place_enrichment_jobs
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
