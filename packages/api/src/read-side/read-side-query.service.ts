import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { statsOverviewSchema, type StatsOverview } from "@radar/shared";
import type { DataSource } from "typeorm";
import {
  EventLocationEntity,
  ParseAttemptEntity,
  ParsedEventEntity,
  PlaceStatusActiveEntity,
  PlaceStatusHistoryEntity,
} from "../events/entities";
import { GeoSyncLogEntity, RegionEntity } from "../geo/entities";

type StatusQuery = {
  placeId?: string;
  statusCode?: string;
};

function buildStatusWhere(params: StatusQuery): StatusQuery {
  return {
    ...(params.placeId ? { placeId: params.placeId } : {}),
    ...(params.statusCode ? { statusCode: params.statusCode } : {}),
  };
}

@Injectable()
export class ReadSideQueryService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async getEvents(limit = 100): Promise<ParsedEventEntity[]> {
    return this.dataSource.getRepository(ParsedEventEntity).find({
      order: { parsedAt: "DESC" },
      take: limit,
    });
  }

  async getRegions(limit = 500): Promise<RegionEntity[]> {
    return this.dataSource.getRepository(RegionEntity).find({
      where: { isActive: true },
      order: { name: "ASC" },
      take: limit,
    });
  }

  async getParseAttempts(params: {
    limit: number;
    status?: "ok" | "failed" | "skipped";
    channelKey?: string;
  }): Promise<ParseAttemptEntity[]> {
    return this.dataSource.getRepository(ParseAttemptEntity).find({
      where: {
        ...(params.status ? { status: params.status } : {}),
        ...(params.channelKey ? { channelKey: params.channelKey } : {}),
      },
      order: { createdAt: "DESC" },
      take: params.limit,
    });
  }

  /** Глобальные агрегаты для админ-дашборда (сообщения, парсинг, каналы, job'ы). */
  async getStatsOverview(): Promise<StatsOverview> {
    const [raw] = await this.dataSource.query<
      Array<{
        raw_total: string;
        live: string;
        backfill: string;
        manual: string;
        last_posted_at: Date | null;
      }>
    >(
      `SELECT
         COUNT(*) AS raw_total,
         COUNT(*) FILTER (WHERE ingest_mode = 'live') AS live,
         COUNT(*) FILTER (WHERE ingest_mode = 'backfill') AS backfill,
         COUNT(*) FILTER (WHERE ingest_mode = 'manual') AS manual,
         MAX(posted_at) AS last_posted_at
       FROM raw_messages`,
    );

    const [parsedEvents] = await this.dataSource.query<Array<{ total: string }>>(
      `SELECT COUNT(*) FILTER (WHERE is_active) AS total FROM parsed_events`,
    );

    const [parse] = await this.dataSource.query<
      Array<{ ok: string; failed: string; skipped: string }>
    >(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'ok') AS ok,
         COUNT(*) FILTER (WHERE status = 'failed') AS failed,
         COUNT(*) FILTER (WHERE status = 'skipped') AS skipped
       FROM parse_attempts`,
    );

    const [channels] = await this.dataSource.query<
      Array<{ total: string; listening: string }>
    >(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE c.enabled AND EXISTS (
           SELECT 1 FROM ingest_bindings b
           JOIN ingest_providers p ON p.id = b.provider_id
           WHERE b.channel_id = c.id AND b.enabled AND p.status = 'active'
         )) AS listening
       FROM channels c`,
    );

    const [providers] = await this.dataSource.query<
      Array<{ total: string; active: string }>
    >(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE status = 'active') AS active
       FROM ingest_providers`,
    );

    const [jobs] = await this.dataSource.query<
      Array<{
        pending: string;
        running: string;
        completed: string;
        failed: string;
        canceled: string;
      }>
    >(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'pending') AS pending,
         COUNT(*) FILTER (WHERE status = 'running') AS running,
         COUNT(*) FILTER (WHERE status = 'completed') AS completed,
         COUNT(*) FILTER (WHERE status = 'failed') AS failed,
         COUNT(*) FILTER (WHERE status = 'canceled') AS canceled
       FROM ingest_backfill_jobs`,
    );

    const phaseRows = await this.dataSource.query<
      Array<{
        phase_id: string;
        pending: string;
        processing: string;
        done: string;
        failed: string;
        done_for_parsed: string;
      }>
    >(
      `SELECT
         pc.phase_id,
         COUNT(*) FILTER (WHERE pc.status = 'pending') AS pending,
         COUNT(*) FILTER (WHERE pc.status = 'processing') AS processing,
         COUNT(*) FILTER (WHERE pc.status = 'done') AS done,
         COUNT(*) FILTER (WHERE pc.status = 'failed') AS failed,
         COUNT(DISTINCT pc.raw_message_id) FILTER (
           WHERE pc.status = 'done'
             AND EXISTS (
               SELECT 1 FROM parsed_events pe
               WHERE pe.raw_message_id = pc.raw_message_id AND pe.is_active = true
             )
         ) AS done_for_parsed
       FROM phase_coverage pc
       GROUP BY pc.phase_id
       ORDER BY pc.phase_id`,
    );

    return statsOverviewSchema.parse({
      rawTotal: Number(raw?.raw_total ?? 0),
      live: Number(raw?.live ?? 0),
      backfill: Number(raw?.backfill ?? 0),
      manual: Number(raw?.manual ?? 0),
      parsedEvents: Number(parsedEvents?.total ?? 0),
      phaseEnrichment: phaseRows.map((row) => ({
        phaseId: row.phase_id,
        counts: {
          pending: Number(row.pending ?? 0),
          processing: Number(row.processing ?? 0),
          done: Number(row.done ?? 0),
          failed: Number(row.failed ?? 0),
          doneForParsed: Number(row.done_for_parsed ?? 0),
        },
      })),
      parseOk: Number(parse?.ok ?? 0),
      parseFailed: Number(parse?.failed ?? 0),
      parseSkipped: Number(parse?.skipped ?? 0),
      channelsTotal: Number(channels?.total ?? 0),
      channelsListening: Number(channels?.listening ?? 0),
      providersTotal: Number(providers?.total ?? 0),
      providersActive: Number(providers?.active ?? 0),
      backfillJobs: {
        pending: Number(jobs?.pending ?? 0),
        running: Number(jobs?.running ?? 0),
        completed: Number(jobs?.completed ?? 0),
        failed: Number(jobs?.failed ?? 0),
        canceled: Number(jobs?.canceled ?? 0),
      },
      lastRawPostedAt: raw?.last_posted_at?.toISOString() ?? null,
    });
  }

  async getGeoSyncHistory(limit = 100): Promise<GeoSyncLogEntity[]> {
    return this.dataSource.getRepository(GeoSyncLogEntity).find({
      order: { startedAt: "DESC" },
      take: limit,
    });
  }

  async getEventLocations(parsedEventId: string): Promise<EventLocationEntity[]> {
    return this.dataSource.getRepository(EventLocationEntity).find({
      where: { parsedEventId },
    });
  }

  async getPlaceStatuses(params: StatusQuery & { limit: number }): Promise<PlaceStatusActiveEntity[]> {
    return this.dataSource.getRepository(PlaceStatusActiveEntity).find({
      where: buildStatusWhere(params),
      order: { updatedAt: "DESC" },
      take: params.limit,
    });
  }

  async getPlaceStatusHistory(
    params: StatusQuery & { limit: number },
  ): Promise<PlaceStatusHistoryEntity[]> {
    return this.dataSource.getRepository(PlaceStatusHistoryEntity).find({
      where: buildStatusWhere(params),
      order: { eventAt: "DESC" },
      take: params.limit,
    });
  }
}
