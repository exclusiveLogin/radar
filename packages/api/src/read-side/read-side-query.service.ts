import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { resolveGeoEnrichmentProvider, statsOverviewSchema, type ParseAttemptItem, type StatsOverview } from "@radar/shared";
import type { DataSource } from "typeorm";
import {
  EventLocationEntity,
  ParsedEventEntity,
} from "../events/entities";
import { GeoSyncLogEntity, RegionEntity } from "../geo/entities";
import { listParseAttemptsForAdmin } from "./parse-attempt-admin.query";
import { loadPhaseCoverageStats } from "./stats-overview.query";

/** Не копим параллельные тяжёлые stats-запросы при поллинге админки. */
const STATS_OVERVIEW_TTL_MS = 5_000;
type StatusQuery = {
  placeId?: string;
  statusCode?: string;
};

@Injectable()
export class ReadSideQueryService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private statsOverviewInflight: Promise<StatsOverview> | null = null;
  private statsOverviewCache: { at: number; value: StatsOverview } | null = null;
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
  }): Promise<ParseAttemptItem[]> {
    return listParseAttemptsForAdmin(this.dataSource, params);
  }

  /** Глобальные агрегаты для админ-дашборда (сообщения, парсинг, каналы, job'ы). */
  async getStatsOverview(): Promise<StatsOverview> {
    const now = Date.now();
    if (this.statsOverviewCache && now - this.statsOverviewCache.at < STATS_OVERVIEW_TTL_MS) {
      return this.statsOverviewCache.value;
    }
    if (this.statsOverviewInflight) return this.statsOverviewInflight;

    this.statsOverviewInflight = this.loadStatsOverview()
      .then((value) => {
        this.statsOverviewCache = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        this.statsOverviewInflight = null;
      });

    return this.statsOverviewInflight;
  }

  private async loadStatsOverview(): Promise<StatsOverview> {
    const [
      rawRows,
      parsedRows,
      parseRows,
      channelRows,
      providerRows,
      jobRows,
      phaseRows,
      placesCatalogRows,
      geoPhaseRows,
      geoJobRows,
      geoEnrichedRows,
      geoCatalogRemainingRows,
    ] = await Promise.all([
      this.dataSource.query<
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
      ),
      this.dataSource.query<Array<{ total: string; active_raws: string }>>(
        `SELECT
           COUNT(*) FILTER (WHERE is_active) AS total,
           COUNT(DISTINCT raw_message_id) FILTER (WHERE is_active) AS active_raws
         FROM parsed_events`,
      ),
      this.dataSource.query<Array<{ ok: string; failed: string; skipped: string }>>(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'ok') AS ok,
           COUNT(*) FILTER (WHERE status = 'failed') AS failed,
           COUNT(*) FILTER (WHERE status = 'skipped') AS skipped
         FROM parse_attempts`,
      ),
      this.dataSource.query<Array<{ total: string; listening: string }>>(
        `SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE c.enabled AND EXISTS (
             SELECT 1 FROM ingest_bindings b
             JOIN ingest_providers p ON p.id = b.provider_id
             WHERE b.channel_id = c.id AND b.enabled AND p.status = 'active'
           )) AS listening
         FROM channels c`,
      ),
      this.dataSource.query<Array<{ total: string; active: string }>>(
        `SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE status = 'active') AS active
         FROM ingest_providers`,
      ),
      this.dataSource.query<
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
      ),
      loadPhaseCoverageStats(this.dataSource),
      this.dataSource.query<Array<{ total: string }>>(
        `SELECT COUNT(*)::int AS total
         FROM places
         WHERE is_active = true AND kind <> 'region'`,
      ),
      this.dataSource.query<Array<{ id: string; enabled: boolean; enrichers: string[] }>>(
        `SELECT id, enabled, enrichers
         FROM phase_definitions
         WHERE scope = 'geoParse'
         ORDER BY id`,
      ),
      this.dataSource.query<Array<{ provider: string; status: string; count: string }>>(
        `SELECT provider, status, COUNT(*)::int AS count
         FROM place_enrichment_jobs
         GROUP BY provider, status`,
      ),
      this.dataSource.query<Array<{ provider: string; count: string }>>(
        `SELECT j.provider, COUNT(DISTINCT j.place_id)::int AS count
         FROM place_enrichment_jobs j
         JOIN places p ON p.id = j.place_id
         WHERE j.status = 'done'
           AND p.is_active = true
           AND p.kind <> 'region'
           AND p.centroid_lat IS NOT NULL
           AND p.centroid_lon IS NOT NULL
         GROUP BY j.provider`,
      ),
      this.dataSource.query<Array<{ provider: string; count: string }>>(
        `SELECT prov.provider, COUNT(*)::int AS count
         FROM places p
         LEFT JOIN geo_feature gf ON gf.id = p.geo_feature_id
         CROSS JOIN (VALUES ('dadata'), ('llm'), ('nominatim')) AS prov(provider)
         WHERE p.is_active = true
           AND p.kind <> 'region'
           AND p.centroid_lat IS NULL
           AND p.centroid_lon IS NULL
           AND (gf.centroid_lat IS NULL OR gf.id IS NULL)
           AND NOT EXISTS (
             SELECT 1 FROM place_enrichment_jobs j
             WHERE j.place_id = p.id
               AND j.provider = prov.provider
               AND j.status = 'processing'
           )
         GROUP BY prov.provider`,
      ),
    ]);

    const raw = rawRows[0];
    const parsedEvents = parsedRows[0];
    const parse = parseRows[0];
    const channels = channelRows[0];
    const providers = providerRows[0];
    const jobs = jobRows[0];
    const placesCatalog = placesCatalogRows[0];
    const geoJobsByProvider = new Map<
      string,
      { pending: number; processing: number; done: number; failed: number }
    >();
    for (const row of geoJobRows) {
      const bucket = geoJobsByProvider.get(row.provider) ?? {
        pending: 0,
        processing: 0,
        done: 0,
        failed: 0,
      };
      if (row.status === "pending") bucket.pending = Number(row.count);
      else if (row.status === "processing") bucket.processing = Number(row.count);
      else if (row.status === "done") bucket.done = Number(row.count);
      else if (row.status === "failed") bucket.failed = Number(row.count);
      geoJobsByProvider.set(row.provider, bucket);
    }

    const geoEnrichedByProvider = new Map(
      geoEnrichedRows.map((row) => [row.provider, Number(row.count ?? 0)]),
    );

    const geoCatalogRemainingByProvider = new Map(
      geoCatalogRemainingRows.map((row) => [row.provider, Number(row.count ?? 0)]),
    );

    const geoEnrichment = geoPhaseRows.map((phase) => {
      const enrichers = phase.enrichers as Array<
        "dadata" | "nominatim" | "llm" | "catalog" | "rule"
      >;
      const provider = resolveGeoEnrichmentProvider({ enrichers });
      const jobs = provider
        ? geoJobsByProvider.get(provider) ?? { pending: 0, processing: 0, done: 0, failed: 0 }
        : { pending: 0, processing: 0, done: 0, failed: 0 };
      return {
        phaseId: phase.id,
        provider,
        enabled: phase.enabled,
        counts: {
          ...jobs,
          doneWithEvidence: provider ? (geoEnrichedByProvider.get(provider) ?? 0) : 0,
          catalogRemaining: provider ? (geoCatalogRemainingByProvider.get(provider) ?? 0) : 0,
        },
      };
    });

    return statsOverviewSchema.parse({
      rawTotal: Number(raw?.raw_total ?? 0),
      live: Number(raw?.live ?? 0),
      backfill: Number(raw?.backfill ?? 0),
      manual: Number(raw?.manual ?? 0),
      parsedEvents: Number(parsedEvents?.total ?? 0),
      parsedEventsActiveRaws: Number(parsedEvents?.active_raws ?? 0),
      placesCatalogActive: Number(placesCatalog?.total ?? 0),
      phaseEnrichment: phaseRows.map((row) => ({
        phaseId: row.phaseId,
        counts: {
          pending: row.pending,
          processing: row.processing,
          done: row.done,
          failed: row.failed,
          doneForParsed: row.doneForParsed,
        },
      })),
      geoEnrichment,
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

  async getPlaceStatuses(params: StatusQuery & { limit: number }): Promise<
    Array<{
      placeId: string;
      regionId: string;
      statusCode: string;
      stateLevel: string;
      action: "raise" | "clear";
      authorChannelKey: string | null;
      updatedAt: string;
      occurredAt: string;
    }>
  > {
    const rows = (await this.dataSource.query(
      `
      WITH ranked AS (
        SELECT el.place_id,
               el.region_id,
               COALESCE(el.status_code, pe.event_type) AS status_code,
               COALESCE(sd.state_level::text, 'grey') AS state_level,
               COALESCE(
                 el.action,
                 CASE WHEN pe.event_type = 'cleared' OR pe.is_active = false THEN 'clear' ELSE 'raise' END
               ) AS action,
               COALESCE(el.author_channel_key, c.key) AS author_channel_key,
               COALESCE(el.occurred_at, rm.posted_at, pe.parsed_at) AS occurred_at,
               ROW_NUMBER() OVER (
                 PARTITION BY el.place_id
                 ORDER BY COALESCE(el.occurred_at, rm.posted_at, pe.parsed_at) DESC, el.id DESC
               ) AS rn
        FROM event_locations el
        JOIN parsed_events pe ON pe.id = el.parsed_event_id
        JOIN raw_messages rm ON rm.id = pe.raw_message_id
        JOIN channels c ON c.id = rm.channel_id
        LEFT JOIN status_dictionary sd
          ON sd.code = COALESCE(el.status_code, pe.event_type) AND sd.is_active = true
        WHERE el.place_id IS NOT NULL
      )
      SELECT place_id, region_id, status_code, state_level, action,
             author_channel_key, occurred_at
      FROM ranked
      WHERE rn = 1
        AND action = 'raise'
        AND ($1::uuid IS NULL OR place_id = $1::uuid)
        AND ($2::text IS NULL OR status_code = $2::text)
      ORDER BY occurred_at DESC
      LIMIT $3
      `,
      [params.placeId ?? null, params.statusCode ?? null, params.limit],
    )) as Array<{
      place_id: string;
      region_id: string;
      status_code: string;
      state_level: string;
      action: "raise" | "clear";
      author_channel_key: string | null;
      occurred_at: Date;
    }>;
    return rows.map((row) => ({
      placeId: row.place_id,
      regionId: row.region_id,
      statusCode: row.status_code,
      stateLevel: row.state_level,
      action: row.action,
      authorChannelKey: row.author_channel_key,
      updatedAt: row.occurred_at.toISOString(),
      occurredAt: row.occurred_at.toISOString(),
    }));
  }

  async getPlaceStatusHistory(
    params: StatusQuery & { limit: number },
  ): Promise<
    Array<{
      eventLocationId: string;
      placeId: string;
      regionId: string;
      statusCode: string;
      action: "raise" | "clear";
      authorChannelKey: string | null;
      occurredAt: string;
    }>
  > {
    const rows = (await this.dataSource.query(
      `
      SELECT el.id, el.place_id, el.region_id,
             COALESCE(el.status_code, pe.event_type) AS status_code,
             COALESCE(el.action, CASE WHEN pe.event_type='cleared' THEN 'clear' ELSE 'raise' END) AS action,
             el.author_channel_key, COALESCE(el.occurred_at, pe.parsed_at) AS occurred_at
      FROM event_locations el
      JOIN parsed_events pe ON pe.id = el.parsed_event_id
      WHERE el.place_id IS NOT NULL
        AND ($1::uuid IS NULL OR el.place_id = $1::uuid)
        AND ($2::text IS NULL OR COALESCE(el.status_code, pe.event_type) = $2::text)
      ORDER BY COALESCE(el.occurred_at, pe.parsed_at) DESC, el.id DESC
      LIMIT $3
      `,
      [params.placeId ?? null, params.statusCode ?? null, params.limit],
    )) as Array<{
      id: string;
      place_id: string;
      region_id: string;
      status_code: string;
      action: "raise" | "clear";
      author_channel_key: string | null;
      occurred_at: Date;
    }>;
    return rows.map((row) => ({
      eventLocationId: row.id,
      placeId: row.place_id,
      regionId: row.region_id,
      statusCode: row.status_code,
      action: row.action,
      authorChannelKey: row.author_channel_key,
      occurredAt: row.occurred_at.toISOString(),
    }));
  }
}
