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
    const placeRows = (await this.deps.dataSource.query(
      `
      UPDATE place_status_read_model
      SET stale = true, stale_at = $2::timestamptz, status_code = 'stale', updated_at = now()
      WHERE stale = false
        AND winner_occurred_at < $1::timestamptz
        AND action = 'raise'
      RETURNING place_id
      `,
      [cutoffIso, atIso],
    )) as Array<{ place_id: string }>;
    return {
      regionsExpired: regionRows.length,
      placesExpired: placeRows.length,
    };
  }
}
