import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import {
  classifyContentKind,
  extractMultipleFixationFlag,
  extractUncertainFlag,
  groomRawTextForDisplay,
  type MessageFeedItem,
  type SourceMessage,
  type StateChangeEventItem,
  type StateLevel,
} from "@radar/shared";
import type { DataSource } from "typeorm";
import { ParseMaintenanceGate } from "../parse-admin/parse-maintenance.gate";

/**
 * Read-модель исходных сообщений и лент обработки.
 * Сохраняет SQL-проекции API отдельно от снапшотов и геометрии карты.
 */
@Injectable()
export class MapMessageFeedQueryService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly parseMaintenance: ParseMaintenanceGate,
  ) {}

  /** Raw-сообщение winner-статуса региона; при statusEventAt — точный матч по occurred_at. */
  async getRegionSourceMessage(
    regionCode: string,
    options?: { statusEventAt?: string },
  ): Promise<SourceMessage | null> {
    return this.parseMaintenance.runRead(async () => {
      const atStatus = options?.statusEventAt?.trim() || null;
      const primary = await this.queryRegionSourceMessage(regionCode, atStatus);
      if (primary || !atStatus) return primary;
      return this.queryRegionSourceMessage(regionCode, null);
    });
  }

  /** Последнее raw-сообщение, привязанное к населённому пункту. */
  async getPlaceSourceMessage(placeId: string): Promise<SourceMessage | null> {
    return this.parseMaintenance.runRead(() => this.loadPlaceSourceMessage(placeId));
  }

  private async loadPlaceSourceMessage(placeId: string): Promise<SourceMessage | null> {
    const rows = (await this.dataSource.query(
      `WITH hit AS (
         SELECT rm.id AS raw_id, pe.id AS parsed_id, rm.raw_text, rm.posted_at, c.key AS channel_key
         FROM mat_ingest_raw rm
         INNER JOIN channels c ON c.id = rm.channel_id
         INNER JOIN mat_parse_event pe ON pe.raw_message_id = rm.id AND pe.is_active = true
         INNER JOIN mat_parse_location el ON el.parsed_event_id = pe.id
         WHERE el.place_id = $1
         ORDER BY rm.posted_at DESC
         LIMIT 1
       )
       SELECT hit.raw_text,
              hit.posted_at,
              hit.channel_key,
              COALESCE(
                array_agg(DISTINCT r2.iso) FILTER (WHERE r2.iso IS NOT NULL),
                '{}'
              ) AS region_codes
       FROM hit
       INNER JOIN mat_parse_location el2 ON el2.parsed_event_id = hit.parsed_id
       INNER JOIN regions r2 ON r2.id = el2.region_id AND r2.is_active = true
       GROUP BY hit.raw_text, hit.posted_at, hit.channel_key`,
      [placeId],
    )) as SourceMessageRow[];

    return this.toSourceMessage(rows[0]);
  }

  /**
   * Лента изменений: только parsed_event с mat_parse_location (ISO на карте).
   * Одна строка = одно событие из одного raw, без дублей без региона.
   */
  async getRecentStateChangeEvents(limit: number): Promise<StateChangeEventItem[]> {
    return this.parseMaintenance.runRead(() => this.loadRecentStateChangeEvents(limit));
  }

  private async loadRecentStateChangeEvents(limit: number): Promise<StateChangeEventItem[]> {
    const rows = (await this.dataSource.query(
      `SELECT pe.id AS parsed_event_id,
              rm.id AS raw_message_id,
              c.key AS channel_key,
              c.title AS channel_title,
              rm.posted_at,
              rm.raw_text,
              pe.event_type,
              pe.extras->>'eventCategory' AS event_category,
              pe.repeat,
              COALESCE((pe.extras->>'uncertain')::boolean, false) AS uncertain,
              COALESCE((pe.extras->>'multiple')::boolean, false) AS multiple,
              COALESCE((pe.extras->>'mass')::boolean, false) AS mass,
              sd.state_level,
              array_agg(DISTINCT r.iso ORDER BY r.iso)
                FILTER (WHERE r.iso IS NOT NULL) AS region_codes,
              array_agg(DISTINCT r.name ORDER BY r.name)
                FILTER (WHERE r.name IS NOT NULL) AS region_names
       FROM mat_parse_event pe
       INNER JOIN mat_ingest_raw rm ON rm.id = pe.raw_message_id
       INNER JOIN channels c ON c.id = rm.channel_id
       INNER JOIN mat_parse_location el ON el.parsed_event_id = pe.id
       INNER JOIN regions r ON r.id = el.region_id AND r.is_active = true
       LEFT JOIN status_dictionary sd
         ON sd.code = pe.event_type AND sd.is_active = true
       WHERE pe.is_active = true
       GROUP BY pe.id, rm.id, c.key, c.title, rm.posted_at, rm.raw_text,
                pe.event_type, pe.extras, pe.repeat, sd.state_level
       ORDER BY rm.posted_at DESC
       LIMIT $1`,
      [limit],
    )) as StateChangeEventRow[];

    return rows.map((row) => ({
      parsedEventId: row.parsed_event_id,
      rawMessageId: row.raw_message_id,
      channelKey: row.channel_key,
      channelTitle: row.channel_title ?? undefined,
      postedAt: row.posted_at.toISOString(),
      rawText: row.raw_text,
      displayText: groomRawTextForDisplay(row.raw_text),
      eventType: row.event_type,
      eventCategory: row.event_category ?? undefined,
      repeat: row.repeat ?? undefined,
      uncertain: row.uncertain ? true : undefined,
      multiple: row.multiple ? true : undefined,
      mass: row.mass ? true : undefined,
      stateLevel: (row.state_level ?? "grey") as StateLevel,
      regionCodes: row.region_codes ?? [],
      regionNames: row.region_names ?? [],
    }));
  }

  /** Последние mat_ingest_raw всех каналов — 1 строка на raw; stats тянут mat_parse_*. */
  async getRecentMessages(limit: number): Promise<MessageFeedItem[]> {
    return this.parseMaintenance.runRead(() => this.loadRecentMessages(limit));
  }

  private async loadRecentMessages(limit: number): Promise<MessageFeedItem[]> {
    const rows = (await this.dataSource.query(
      `SELECT rm.id,
              c.key AS channel_key,
              c.title AS channel_title,
              rm.posted_at,
              rm.raw_text,
              rm.ingest_mode,
              COALESCE(stats.parsed_event_count, 0)::int AS parsed_event_count,
              COALESCE(stats.location_count, 0)::int AS location_count,
              stats.primary_event_type AS event_type,
              stats.event_category,
              stats.repeat,
              stats.uncertain,
              stats.multiple,
              stats.mass,
              stats.state_level,
              COALESCE(stats.region_codes, '{}') AS region_codes
       FROM mat_ingest_raw rm
       INNER JOIN channels c ON c.id = rm.channel_id
       LEFT JOIN LATERAL (
         SELECT COUNT(DISTINCT pe.id)::int AS parsed_event_count,
                COUNT(DISTINCT el.id)::int AS location_count,
                (array_agg(pe.event_type ORDER BY pe.parsed_at DESC))[1] AS primary_event_type,
                (array_agg(pe.extras->>'eventCategory' ORDER BY pe.parsed_at DESC))[1] AS event_category,
                bool_or(pe.repeat) AS repeat,
                bool_or(COALESCE((pe.extras->>'uncertain')::boolean, false)) AS uncertain,
                bool_or(COALESCE((pe.extras->>'multiple')::boolean, false)) AS multiple,
                bool_or(COALESCE((pe.extras->>'mass')::boolean, false)) AS mass,
                (array_agg(sd.state_level ORDER BY pe.parsed_at DESC))[1] AS state_level,
                array_agg(DISTINCT r.iso) FILTER (WHERE r.iso IS NOT NULL) AS region_codes
         FROM mat_parse_event pe
         LEFT JOIN status_dictionary sd ON sd.code = pe.event_type AND sd.is_active = true
         LEFT JOIN mat_parse_location el ON el.parsed_event_id = pe.id
         LEFT JOIN regions r ON r.id = el.region_id
         WHERE pe.raw_message_id = rm.id AND pe.is_active = true
       ) stats ON true
       ORDER BY rm.posted_at DESC
       LIMIT $1`,
      [limit],
    )) as MessageFeedRow[];

    return rows.map((row) => ({
      id: row.id,
      channelKey: row.channel_key,
      channelTitle: row.channel_title ?? undefined,
      postedAt: row.posted_at.toISOString(),
      rawText: row.raw_text,
      ingestMode: row.ingest_mode,
      contentKind: classifyContentKind(row.raw_text),
      parsedEventCount: row.parsed_event_count,
      hasLocations: row.location_count > 0,
      eventType: row.event_type ?? undefined,
      eventCategory: row.event_category ?? undefined,
      repeat: row.repeat ?? undefined,
      uncertain: row.uncertain || extractUncertainFlag(row.raw_text) ? true : undefined,
      multiple: row.multiple || extractMultipleFixationFlag(row.raw_text) ? true : undefined,
      mass: row.mass ? true : undefined,
      stateLevel: row.state_level ?? undefined,
      regionCodes: row.region_codes ?? [],
    }));
  }

  /** Region-level EL (не place): последний или на маркер statusEventAt. */
  private async queryRegionSourceMessage(
    regionCode: string,
    statusEventAt: string | null,
  ): Promise<SourceMessage | null> {
    const rows = (await this.dataSource.query(
      `WITH hit AS (
         SELECT rm.id AS raw_id,
                pe.id AS parsed_id,
                rm.raw_text,
                rm.posted_at,
                c.key AS channel_key,
                COALESCE(el.occurred_at, rm.posted_at) AS event_at
         FROM mat_ingest_raw rm
         INNER JOIN channels c ON c.id = rm.channel_id
         INNER JOIN mat_parse_event pe ON pe.raw_message_id = rm.id AND pe.is_active = true
         INNER JOIN mat_parse_location el ON el.parsed_event_id = pe.id
         INNER JOIN regions r ON r.id = el.region_id AND r.is_active = true
         WHERE r.iso = $1
           AND COALESCE(el.entity_kind, 'region') <> 'place'
           AND ($2::timestamptz IS NULL
                OR COALESCE(el.occurred_at, rm.posted_at) = $2::timestamptz)
         ORDER BY COALESCE(el.occurred_at, rm.posted_at) DESC
         LIMIT 1
       )
       SELECT hit.raw_text,
              hit.posted_at,
              hit.channel_key,
              COALESCE(
                array_agg(DISTINCT r2.iso) FILTER (WHERE r2.iso IS NOT NULL),
                '{}'
              ) AS region_codes
       FROM hit
       INNER JOIN mat_parse_location el2 ON el2.parsed_event_id = hit.parsed_id
       INNER JOIN regions r2 ON r2.id = el2.region_id AND r2.is_active = true
       GROUP BY hit.raw_text, hit.posted_at, hit.channel_key`,
      [regionCode, statusEventAt],
    )) as SourceMessageRow[];

    return this.toSourceMessage(rows[0]);
  }

  /** Преобразует строку SQL-проекции в публичный контракт сообщения. */
  private toSourceMessage(row: SourceMessageRow | undefined): SourceMessage | null {
    if (!row) return null;
    return {
      rawText: row.raw_text,
      displayText: groomRawTextForDisplay(row.raw_text),
      postedAt: row.posted_at.toISOString(),
      channelKey: row.channel_key,
      regionCodes: row.region_codes ?? [],
    };
  }
}

type SourceMessageRow = {
  raw_text: string;
  posted_at: Date;
  channel_key: string;
  region_codes: string[];
};

type StateChangeEventRow = {
  parsed_event_id: string;
  raw_message_id: string;
  channel_key: string;
  channel_title: string | null;
  posted_at: Date;
  raw_text: string;
  event_type: string;
  event_category: string | null;
  repeat: boolean | null;
  uncertain: boolean | null;
  multiple: boolean | null;
  mass: boolean | null;
  state_level: StateLevel | null;
  region_codes: string[];
  region_names: string[];
};

type MessageFeedRow = {
  id: string;
  channel_key: string;
  channel_title: string | null;
  posted_at: Date;
  raw_text: string;
  ingest_mode: MessageFeedItem["ingestMode"];
  parsed_event_count: number;
  location_count: number;
  event_type: string | null;
  event_category: string | null;
  repeat: boolean | null;
  uncertain: boolean | null;
  multiple: boolean | null;
  mass: boolean | null;
  state_level: StateLevel | null;
  region_codes: string[] | null;
};
