import type { DataSource } from "typeorm";

type SweepDeps = {
  dataSource: DataSource;
  ttlMs: number;
};

export type MapStateExpiryResult = {
  regionsExpired: number;
  placesExpired: number;
};


/** TTL sweep для нового read-model: помечает просроченные winner как stale. */
export class MapStateExpirySweep {
  constructor(private readonly deps: SweepDeps) {}

  async run(at: Date = new Date()): Promise<MapStateExpiryResult> {
    const cutoffIso = new Date(at.getTime() - this.deps.ttlMs).toISOString();
    const { regionsExpired, placesExpired } = await this.markReadModelsStale(
      cutoffIso,
      at.toISOString(),
    );
    return { regionsExpired, placesExpired };
  }

  private async markReadModelsStale(
    cutoffIso: string,
    atIso: string,
  ): Promise<{ regionsExpired: number; placesExpired: number }> {
    const regionRows = (await this.deps.dataSource.query(
      `
      UPDATE region_status_read_model
      SET stale = true, stale_at = $2::timestamptz, status_code = 'stale', updated_at = now()
      WHERE stale = false
        AND winner_occurred_at < $1::timestamptz
        AND action = 'raise'
      RETURNING region_id
      `,
      [cutoffIso, atIso],
    )) as Array<{ region_id: string }>;

    const expiredRegionIds = regionRows.map((r) => r.region_id);

    // Дочерние places гасим вместе с регионом — сайд-эффект TTL региона.
    let placesExpired = 0;
    if (expiredRegionIds.length > 0) {
      const placeRows = (await this.deps.dataSource.query(
        `
        UPDATE place_status_read_model
        SET stale = true, stale_at = $2::timestamptz, status_code = 'stale', updated_at = now()
        WHERE stale = false
          AND action = 'raise'
          AND region_id = ANY($1::uuid[])
        RETURNING place_id
        `,
        [expiredRegionIds, atIso],
      )) as Array<{ place_id: string }>;
      placesExpired = placeRows.length;
    }

    // Места без активного региона тоже истекают независимо (по собственному TTL).
    const orphanRows = (await this.deps.dataSource.query(
      `
      UPDATE place_status_read_model
      SET stale = true, stale_at = $2::timestamptz, status_code = 'stale', updated_at = now()
      WHERE stale = false
        AND winner_occurred_at < $1::timestamptz
        AND action = 'raise'
        AND (
          region_id IS NULL
          OR region_id NOT IN (
            SELECT region_id FROM region_status_read_model WHERE action = 'raise' AND stale = false
          )
        )
      RETURNING place_id
      `,
      [cutoffIso, atIso],
    )) as Array<{ place_id: string }>;

    return {
      regionsExpired: regionRows.length,
      placesExpired: placesExpired + orphanRows.length,
    };
  }
}
