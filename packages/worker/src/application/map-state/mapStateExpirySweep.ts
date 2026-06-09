import type { DataSource } from "typeorm";

type SweepDeps = {
  dataSource: DataSource;
  ttlMs: number;
};

export type MapStateExpiryResult = {
  regionsExpired: number;
  placesExpired: number;
  placesClearedByRegion: number;
};


/** TTL sweep для read-model: регион и place — независимые окна. */
export class MapStateExpirySweep {
  constructor(private readonly deps: SweepDeps) {}

  async run(at: Date = new Date()): Promise<MapStateExpiryResult> {
    const cutoffIso = new Date(at.getTime() - this.deps.ttlMs).toISOString();
    const atIso = at.toISOString();

    const regionRows = await this.expireStaleRegions(cutoffIso, atIso);
    const cascadedPlaces = await this.expirePlacesInRegions(
      regionRows.map((row) => row.region_id),
      atIso,
    );
    const placesExpired = await this.expireStalePlacesByOwnTtl(cutoffIso, atIso);
    const placesClearedByRegion = await this.applyRegionalClearToPlaces();

    return {
      regionsExpired: regionRows.length,
      placesExpired: cascadedPlaces + placesExpired,
      placesClearedByRegion,
    };
  }

  private async expireStaleRegions(
    cutoffIso: string,
    atIso: string,
  ): Promise<Array<{ region_id: string }>> {
    return (await this.deps.dataSource.query(
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
  }

  /** Каскад: протухший регион → все его place raise тоже stale. */
  private async expirePlacesInRegions(
    expiredRegionIds: string[],
    atIso: string,
  ): Promise<number> {
    if (expiredRegionIds.length === 0) return 0;

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
    return placeRows.length;
  }

  /**
   * Place TTL от собственного winner_occurred_at — независимо от свежих сообщений по региону.
   */
  private async expireStalePlacesByOwnTtl(
    cutoffIso: string,
    atIso: string,
  ): Promise<number> {
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
    return placeRows.length;
  }

  /**
   * Региональный clear новее place raise → place action=clear (write-side SSOT).
   */
  private async applyRegionalClearToPlaces(): Promise<number> {
    const rows = (await this.deps.dataSource.query(
      `
      UPDATE place_status_read_model psm
      SET action = 'clear',
          status_code = rsm.status_code,
          state_level = rsm.state_level,
          winner_occurred_at = rsm.winner_occurred_at,
          stale = false,
          stale_at = NULL,
          updated_at = now()
      FROM region_status_read_model rsm
      WHERE psm.region_id = rsm.region_id
        AND rsm.stale = false
        AND rsm.action = 'clear'
        AND rsm.winner_occurred_at > psm.winner_occurred_at
        AND psm.action = 'raise'
        AND psm.stale = false
      RETURNING psm.place_id
      `,
    )) as Array<{ place_id: string }>;
    return rows.length;
  }
}
