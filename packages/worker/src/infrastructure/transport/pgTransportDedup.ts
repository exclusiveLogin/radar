import type { DataSource } from "typeorm";
import type { ITransportDedup } from "@radar/shared";

/** PG L2 dedup — INSERT ON CONFLICT для transport_dedup. */
export function createPgTransportDedup(dataSource: DataSource): ITransportDedup {
  return {
    async tryClaim(eventId: string): Promise<boolean> {
      const rows = (await dataSource.query(
        `INSERT INTO transport_dedup (event_id, consumed_at) VALUES ($1, now())
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id`,
        [eventId],
      )) as Array<{ event_id: string }>;
      return rows.length > 0;
    },
  };
}
