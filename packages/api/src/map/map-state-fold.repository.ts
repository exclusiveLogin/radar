import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { DataSource } from "typeorm";
import type { EventLocationFact, MapStatusAction, StateLevel } from "@radar/shared";

type FactRow = {
  fact_id: string;
  region_id: string;
  region_code: string | null;
  place_id: string | null;
  status_code: string;
  state_level: string;
  action: string;
  author_channel_key: string | null;
  entity_kind: string | null;
  occurred_at: Date;
};

type SyntheticClearRow = {
  fact_id: string;
  region_id: string;
  region_code: string | null;
  status_code: string;
  state_level: string;
  author_channel_key: string | null;
  occurred_at: Date;
};

/** Загрузка фактов event_locations для fold на маркер asOf. */
@Injectable()
export class MapStateFoldRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async loadFacts(asOf: Date, ttlMs: number): Promise<EventLocationFact[]> {
    const cutoff = new Date(asOf.getTime() - ttlMs);
    const locationFacts = await this.loadLocationFacts(asOf, cutoff);
    const syntheticClears = await this.loadChannelClearFacts(asOf, cutoff);
    return [...locationFacts, ...syntheticClears];
  }

  private async loadLocationFacts(asOf: Date, cutoff: Date): Promise<EventLocationFact[]> {
    const rows = (await this.dataSource.query(
      `
      SELECT el.id AS fact_id,
             el.region_id,
             r.iso AS region_code,
             el.place_id,
             COALESCE(el.status_code, pe.event_type) AS status_code,
             COALESCE(sd.state_level::text, 'grey') AS state_level,
             COALESCE(
               el.action,
               CASE WHEN pe.event_type = 'cleared' OR pe.is_active = false THEN 'clear' ELSE 'raise' END
             ) AS action,
             COALESCE(el.author_channel_key, c.key) AS author_channel_key,
             el.entity_kind,
             COALESCE(el.occurred_at, rm.posted_at, pe.parsed_at) AS occurred_at
      FROM event_locations el
      JOIN parsed_events pe ON pe.id = el.parsed_event_id
      JOIN raw_messages rm ON rm.id = pe.raw_message_id
      JOIN channels c ON c.id = rm.channel_id
      LEFT JOIN regions r ON r.id = el.region_id
      LEFT JOIN status_dictionary sd
        ON sd.code = COALESCE(el.status_code, pe.event_type) AND sd.is_active = true
      WHERE COALESCE(el.occurred_at, rm.posted_at, pe.parsed_at) <= $1::timestamptz
        AND COALESCE(el.occurred_at, rm.posted_at, pe.parsed_at) > $2::timestamptz
      `,
      [asOf.toISOString(), cutoff.toISOString()],
    )) as FactRow[];

    return rows.map((row) => this.toFact(row));
  }

  /**
   * Глобальный отбой без locations: синтетические clear-факты по регионам канала с raise за 24ч.
   * Эквивалент clearChannelRegions в LastWinnerReadModelProjection.
   */
  private async loadChannelClearFacts(asOf: Date, cutoff: Date): Promise<EventLocationFact[]> {
    const rows = (await this.dataSource.query(
      `
      WITH global_clears AS (
        SELECT pe.id AS parsed_event_id,
               rm.posted_at AS clear_at,
               c.key AS channel_key
        FROM parsed_events pe
        JOIN raw_messages rm ON rm.id = pe.raw_message_id
        JOIN channels c ON c.id = rm.channel_id
        WHERE (pe.event_type = 'cleared' OR pe.is_active = false)
          AND rm.posted_at <= $1::timestamptz
          AND rm.posted_at > $2::timestamptz
          AND NOT EXISTS (
            SELECT 1 FROM event_locations el WHERE el.parsed_event_id = pe.id
          )
      )
      SELECT DISTINCT ON (gc.parsed_event_id, el.region_id)
             gc.parsed_event_id::text AS fact_id,
             el.region_id,
             r.iso AS region_code,
             COALESCE(sd_clear.code, 'cleared') AS status_code,
             COALESCE(sd_clear.state_level::text, 'green') AS state_level,
             gc.channel_key AS author_channel_key,
             gc.clear_at AS occurred_at
      FROM global_clears gc
      JOIN event_locations el ON el.action = 'raise'
        AND el.occurred_at > gc.clear_at - INTERVAL '24 hours'
        AND el.occurred_at <= $1::timestamptz
      JOIN parsed_events pe_raise ON pe_raise.id = el.parsed_event_id
      JOIN raw_messages rm_raise ON rm_raise.id = pe_raise.raw_message_id
      JOIN channels c_raise ON c_raise.id = rm_raise.channel_id AND c_raise.key = gc.channel_key
      JOIN regions r ON r.id = el.region_id
      LEFT JOIN status_dictionary sd_clear
        ON sd_clear.code = 'cleared' AND sd_clear.is_active = true
      ORDER BY gc.parsed_event_id, el.region_id, el.occurred_at DESC
      `,
      [asOf.toISOString(), cutoff.toISOString()],
    )) as SyntheticClearRow[];

    return rows.map((row) => ({
      factId: `synthetic-clear:${row.fact_id}:${row.region_id}`,
      regionId: row.region_id,
      regionCode: row.region_code ?? row.region_id,
      placeId: null,
      statusCode: row.status_code,
      stateLevel: row.state_level as StateLevel,
      action: "clear" as MapStatusAction,
      occurredAt: new Date(row.occurred_at).toISOString(),
      authorChannelKey: row.author_channel_key,
      entityKind: "region",
    }));
  }

  private toFact(row: FactRow): EventLocationFact {
    return {
      factId: row.fact_id,
      regionId: row.region_id,
      regionCode: row.region_code ?? row.region_id,
      placeId: row.place_id,
      statusCode: row.status_code,
      stateLevel: row.state_level as StateLevel,
      action: row.action as MapStatusAction,
      occurredAt: new Date(row.occurred_at).toISOString(),
      authorChannelKey: row.author_channel_key,
      entityKind: row.entity_kind as EventLocationFact["entityKind"],
    };
  }
}
