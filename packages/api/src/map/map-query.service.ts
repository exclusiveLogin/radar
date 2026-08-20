import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { DataSource } from "typeorm";
import { In } from "typeorm";
import type {
  MapRegionSnapshot,
  MapSnapshot,
  StateChangeEventItem,
  StateLevel,
  StatusDictionary,
  Warning,
  EventHeatmapPeriod,
  EventHeatmapResponse,
} from "@radar/shared";
import { STATE_LEVEL_RANK, eventHeatmapPeriodMs } from "@radar/shared";
import type { EventType } from "@radar/shared";
import { StatusDictionaryEntity } from "@radar/persistence";
import { PlaceEntity, RegionEntity } from "@radar/persistence";
import type { GeoRegionRef, PlaceRef } from "./map.dto";
import { ParseMaintenanceGate } from "../parse-admin/parse-maintenance.gate";
import { MapGeoJsonQueryService } from "./map-geojson-query.service";
import { MapSnapshotQueryService } from "./map-snapshot-query.service";
import { RegionAdjacencyRepository } from "./region-adjacency.repository";

type RegionStateLevel = MapRegionSnapshot["stateLevel"];

/** Преобразует numeric-строку TypeORM в число (или undefined). */
function toNumber(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

@Injectable()
export class MapQueryService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly mapSnapshotQuery: MapSnapshotQueryService,
    private readonly mapGeoJsonQuery: MapGeoJsonQueryService,
    private readonly parseMaintenance: ParseMaintenanceGate,
    private readonly regionAdjacency: RegionAdjacencyRepository,
  ) {}

  getActiveDistrictsGeoJsonLayer() {
    return this.mapGeoJsonQuery.getActiveDistrictsGeoJsonLayer();
  }

  getDistrictsGeoJsonLayer(input?: { regionId?: string; geoFeatureIds?: string[] }) {
    return this.mapGeoJsonQuery.getDistrictsGeoJsonLayer(input);
  }

  getRegionsGeoJsonLayer(regionCodes: string[]) {
    return this.mapGeoJsonQuery.getRegionsGeoJsonLayer(regionCodes);
  }

  async getRegionsStateAt(asOf: Date) {
    return this.mapSnapshotQuery.getRegionsStateAt(asOf);
  }

  async getPlacesStateAt(asOf: Date, regionId?: string) {
    return this.mapSnapshotQuery.getPlacesStateAt(asOf, regionId);
  }

  /** Historical snapshot: fold фактов на маркер asOf (read-line, фаза 1). */
  async getSnapshotAt(asOf: Date): Promise<MapSnapshot> {
    return this.mapSnapshotQuery.getSnapshotAt(asOf);
  }

  /** Лёгкий снапшот карты: fold фактов на now. */
  async getSnapshot(since?: string): Promise<MapSnapshot> {
    const snapshot = await this.mapSnapshotQuery.getSnapshotAt(new Date());
    if (!since) return snapshot;
    const sinceDate = new Date(since);
    if (!Number.isFinite(sinceDate.getTime())) return snapshot;
    return {
      generatedAt: snapshot.generatedAt,
      regions: snapshot.regions.filter(
        (region) => region.statusEventAt && new Date(region.statusEventAt) > sinceDate,
      ),
      places: snapshot.places.filter(
        (place) => place.statusEventAt && new Date(place.statusEventAt) > sinceDate,
      ),
      vicinityScopes: (snapshot.vicinityScopes ?? []).filter(
        (scope) => scope.statusEventAt && new Date(scope.statusEventAt) > sinceDate,
      ),
    };
  }

  /** Тяжёлая геометрия: ссылки на регионы (centroid/bbox/artifactKey), тянется лениво гео-виджетом. */
  async getGeoRegions(): Promise<GeoRegionRef[]> {
    const regions = await this.dataSource.getRepository(RegionEntity).find({
      where: { isActive: true },
      order: { name: "ASC" },
    });
    return regions.map((region) => this.toGeoRef(region));
  }

  async getRegionGeometry(regionId: string): Promise<GeoRegionRef | null> {
    const region = await this.dataSource
      .getRepository(RegionEntity)
      .findOne({ where: { id: regionId } });
    return region ? this.toGeoRef(region) : null;
  }

  async getStatusDictionary(): Promise<StatusDictionary> {
    const rows = await this.dataSource
      .getRepository(StatusDictionaryEntity)
      .find({ where: { isActive: true }, order: { priority: "ASC" } });
    return {
      version: 1,
      statuses: rows.map((row) => ({
        code: row.code,
        title: row.title,
        includeOnMap: row.includeOnMap,
        parserHints: row.parserHints,
        stateLevel: row.stateLevel,
        isActive: row.isActive,
        priority: row.priority,
      })),
    };
  }

  async getPlaces(regionId: string | undefined, limit: number): Promise<PlaceRef[]> {
    const rows = await this.dataSource.getRepository(PlaceEntity).find({
      where: {
        isActive: true,
        ...(regionId ? { regionId } : {}),
      },
      order: { name: "ASC" },
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      regionId: row.regionId,
      name: row.name,
      kind: row.kind,
      centroidLat: toNumber(row.centroidLat),
      centroidLon: toNumber(row.centroidLon),
    }));
  }

  /** Фид предупреждений (аккордеон): последние региональные факты из mat_parse_location. */
  async getWarnings(
    params: { regionId?: string; since?: string; limit: number },
  ): Promise<Warning[]> {
    return this.parseMaintenance.runRead(() => this.loadWarnings(params));
  }

  private async loadWarnings(
    params: { regionId?: string; since?: string; limit: number },
  ): Promise<Warning[]> {
    const rows = (await this.dataSource.query(
      `
      SELECT el.region_id,
             r.iso AS region_code,
             COALESCE(sd.state_level::text, 'grey') AS state_level,
             COALESCE(el.status_code, pe.event_type) AS status_code,
             COALESCE(el.occurred_at, rm.posted_at, pe.parsed_at) AS event_at
      FROM mat_parse_location el
      JOIN mat_parse_event pe ON pe.id = el.parsed_event_id
      JOIN mat_ingest_raw rm ON rm.id = pe.raw_message_id
      JOIN regions r ON r.id = el.region_id
      LEFT JOIN status_dictionary sd
        ON sd.code = COALESCE(el.status_code, pe.event_type) AND sd.is_active = true
      WHERE COALESCE(el.entity_kind, 'region') <> 'place'
        AND ($1::uuid IS NULL OR el.region_id = $1::uuid)
        AND ($2::timestamptz IS NULL OR COALESCE(el.occurred_at, rm.posted_at, pe.parsed_at) > $2::timestamptz)
      ORDER BY COALESCE(el.occurred_at, rm.posted_at, pe.parsed_at) DESC
      LIMIT $3
      `,
      [params.regionId ?? null, params.since ?? null, params.limit],
    )) as Array<{
      region_id: string;
      region_code: string;
      state_level: RegionStateLevel;
      status_code: string;
      event_at: Date;
    }>;
    const regionNames = await this.loadRegionNames(rows.map((row) => row.region_id));
    return rows.map((row) => ({
      id: `${row.region_id}:${new Date(row.event_at).toISOString()}`,
      regionId: row.region_id,
      regionCode: row.region_code,
      regionName: regionNames.get(row.region_id),
      title: this.warningTitle(row.state_level),
      text: row.status_code ?? undefined,
      stateLevel: row.state_level,
      eventAt: new Date(row.event_at).toISOString(),
    }));
  }

  private async loadRegionNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.dataSource.getRepository(RegionEntity).find({
      where: { id: In(unique) },
    });
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  private warningTitle(level: RegionStateLevel): string {
    const titles: Record<RegionStateLevel, string> = {
      grey: "Нет данных",
      green: "Отбой",
      yellow: "Внимание",
      orange: "Повышенная опасность",
      red: "Опасность",
    };
    return titles[level];
  }

  private toGeoRef(region: RegionEntity): GeoRegionRef {
    return {
      regionId: region.id,
      regionCode: region.iso ?? region.fiasId ?? region.name,
      name: region.name,
      centroidLat: toNumber(region.centroidLat),
      centroidLon: toNumber(region.centroidLon),
      bbox: region.bbox ?? undefined,
      geometryArtifactKey: region.geometryArtifactKey ?? undefined,
    };
  }

  /**
   * Последние сводки ПВО (pvo_report) — только информационные события без влияния на карту.
   * Возвращает отчёты с распарсенными данными из extras.pvo.
   */
  async getPvoReports(limit = 50, since?: string): Promise<PvoReportRow[]> {
    return this.parseMaintenance.runRead(async () => {
      const sinceClause = since ? `AND rm.posted_at > $2` : "";
      const params: unknown[] = [limit];
      if (since) params.push(since);

      const rows = await this.dataSource.query<RawPvoReportRow[]>(
        `SELECT pe.id,
                pe.extras->'pvo'        AS stats,
                rm.raw_text,
                rm.posted_at,
                ch.key                  AS channel_key,
                ch.title                AS channel_title
           FROM mat_parse_event pe
           JOIN mat_ingest_raw rm ON rm.id = pe.raw_message_id
           JOIN channels ch ON ch.id = rm.channel_id
          WHERE pe.event_type = 'pvo_report'
            ${sinceClause}
          ORDER BY rm.posted_at DESC
          LIMIT $1`,
        params,
      );

      return rows.map((row) => ({
        id:           row.id,
        postedAt:     row.posted_at,
        channelKey:   row.channel_key,
        channelTitle: row.channel_title,
        rawText:      row.raw_text,
        stats:        row.stats ?? null,
      }));
    });
  }
  /** Смежность регионов (ISO → соседние ISO) из region_adjacency — диагностика графа. */
  async getRegionAdjacency(): Promise<Record<string, string[]>> {
    return this.regionAdjacency.load();
  }

  /**
   * Топ-N регионов по количеству danger (red) событий за последние 7 дней.
   * Используется в TopActivityWidget для рейтинга активности.
   */
  async getTopActivityRegions(limit = 10): Promise<TopActivityRow[]> {
    return this.parseMaintenance.runRead(async () => {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const rows = (await this.dataSource.query(
        `SELECT r.iso        AS region_code,
                r.name,
                COUNT(DISTINCT pe.id) AS event_count
         FROM mat_parse_event pe
         JOIN mat_parse_location el ON el.parsed_event_id = pe.id
         JOIN regions r           ON r.id = el.region_id AND r.is_active = true
         JOIN mat_ingest_raw rm     ON rm.id = pe.raw_message_id
         JOIN status_dictionary sd ON sd.code = pe.event_type AND sd.is_active = true
         WHERE pe.is_active = true
           AND sd.state_level = 'red'
           AND rm.posted_at >= $2::timestamptz
         GROUP BY r.iso, r.name
         ORDER BY event_count DESC
         LIMIT $1`,
        [limit, since],
      )) as Array<{ region_code: string; name: string; event_count: string }>;

      return rows.map((row) => ({
        regionCode: row.region_code,
        name: row.name,
        eventCount: Number(row.event_count),
      }));
    });
  }

  /**
   * История событий для конкретного региона: last N mat_parse_event, влияющих на карту.
   * Используется в RegionDetailWidget для отображения хронологии.
   */
  async getRegionEvents(regionCode: string, limit = 50): Promise<StateChangeEventItem[]> {
    return this.parseMaintenance.runRead(() => this.loadRegionEvents(regionCode, limit));
  }

  private async loadRegionEvents(regionCode: string, limit: number): Promise<StateChangeEventItem[]> {
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
       INNER JOIN regions r ON r.id = el.region_id AND r.iso = $2
       INNER JOIN status_dictionary sd
         ON sd.code = pe.event_type AND sd.is_active = true
       WHERE pe.is_active = true
         AND sd.state_level IS NOT NULL
         AND sd.state_level <> 'grey'
       GROUP BY pe.id, rm.id, c.key, c.title, rm.posted_at, rm.raw_text,
                pe.event_type, pe.extras, pe.repeat, sd.state_level
       ORDER BY rm.posted_at DESC
       LIMIT $1`,
      [limit, regionCode],
    )) as Array<{
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
      state_level: StateLevel;
      region_codes: string[];
      region_names: string[];
    }>;

    return rows.map((row) => ({
      parsedEventId: row.parsed_event_id,
      rawMessageId: row.raw_message_id,
      channelKey: row.channel_key,
      channelTitle: row.channel_title ?? undefined,
      postedAt: row.posted_at.toISOString(),
      rawText: row.raw_text,
      eventType: row.event_type,
      eventCategory: row.event_category ?? undefined,
      repeat: row.repeat ?? undefined,
      uncertain: row.uncertain ? true : undefined,
      multiple: row.multiple ? true : undefined,
      mass: row.mass ? true : undefined,
      stateLevel: row.state_level,
      regionCodes: row.region_codes ?? [],
      regionNames: row.region_names ?? [],
    }));
  }

  /**
   * Точки raise-событий для теплокарты (read-side, PG; future: ClickHouse adapter).
   * Только place; координаты как на live-карте: el → place.centroid → geo_feature.centroid
   * (@see map-centroid.resolver resolvePlaceMapCentroid).
   */
  async getEventsHeatmapGeoJson(params: {
    period: EventHeatmapPeriod;
    until?: Date;
    limit?: number;
    eventTypes?: EventType[];
  }): Promise<EventHeatmapResponse> {
    return this.parseMaintenance.runRead(() => this.loadEventsHeatmapGeoJson(params));
  }

  private async loadEventsHeatmapGeoJson(params: {
    period: EventHeatmapPeriod;
    until?: Date;
    limit?: number;
    eventTypes?: EventType[];
  }): Promise<EventHeatmapResponse> {
    const until = params.until ?? new Date();
    const limit = Math.min(Math.max(params.limit ?? 8000, 1), 15000);
    const periodMs = eventHeatmapPeriodMs(params.period);
    const since =
      periodMs === null ? null : new Date(until.getTime() - periodMs);

    const rows = (await this.dataSource.query(
      `SELECT el.id,
              COALESCE(el.lon, p.centroid_lon, gf.centroid_lon, r.centroid_lon)::float AS lon,
              COALESCE(el.lat, p.centroid_lat, gf.centroid_lat, r.centroid_lat)::float AS lat,
              sd.state_level,
              COALESCE(el.occurred_at, rm.posted_at) AS occurred_at
       FROM mat_parse_location el
       JOIN mat_parse_event pe ON pe.id = el.parsed_event_id AND pe.is_active = true
       JOIN mat_ingest_raw rm ON rm.id = pe.raw_message_id
       LEFT JOIN places p ON p.id = el.place_id AND p.is_active = true
       LEFT JOIN LATERAL (
         SELECT l.geo_feature_id
         FROM place_geo_link l
         WHERE l.place_id = p.id
         ORDER BY l.priority ASC, l.geo_feature_id
         LIMIT 1
       ) pgl ON el.place_id IS NOT NULL
       LEFT JOIN geo_feature gf ON gf.id = COALESCE(p.geo_feature_id, pgl.geo_feature_id)
       LEFT JOIN regions r ON r.id = el.region_id
       JOIN status_dictionary sd
         ON sd.code = COALESCE(el.status_code, pe.event_type) AND sd.is_active = true
       WHERE el.action = 'raise'
         AND sd.state_level IS NOT NULL
         AND sd.state_level NOT IN ('grey', 'green')
         AND COALESCE(el.lon, p.centroid_lon, gf.centroid_lon, r.centroid_lon) IS NOT NULL
         AND COALESCE(el.lat, p.centroid_lat, gf.centroid_lat, r.centroid_lat) IS NOT NULL
         AND (el.place_id IS NOT NULL OR el.region_id IS NOT NULL)
         AND ($2::timestamptz IS NULL OR rm.posted_at >= $2::timestamptz)
         AND rm.posted_at <= $1::timestamptz
         AND ($4::text[] IS NULL OR COALESCE(el.status_code, pe.event_type) = ANY($4::text[]))
       ORDER BY occurred_at DESC
       LIMIT $3`,
      [
        until.toISOString(),
        since?.toISOString() ?? null,
        limit,
        params.eventTypes ?? null,
      ],
    )) as Array<{
      id: string;
      lon: number;
      lat: number;
      state_level: StateLevel;
      occurred_at: Date;
    }>;

    const features = rows.map((row) => {
      const stateLevel = row.state_level;
      const weight = Math.max(1, STATE_LEVEL_RANK[stateLevel] ?? 1);
      return {
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [row.lon, row.lat] as [number, number],
        },
        properties: {
          weight,
          stateLevel,
          occurredAt: row.occurred_at.toISOString(),
        },
      };
    });

    return {
      type: "FeatureCollection",
      features,
      meta: {
        period: params.period,
        since: since?.toISOString() ?? null,
        until: until.toISOString(),
        count: features.length,
        eventTypes: params.eventTypes ?? null,
      },
    };
  }

}

type RawPvoReportRow = {
  id: string;
  stats: unknown;
  raw_text: string;
  posted_at: string;
  channel_key: string;
  channel_title: string;
};

export type PvoReportRow = {
  id: string;
  postedAt: string;
  channelKey: string;
  channelTitle: string;
  rawText: string;
  stats: unknown;
};

export type TopActivityRow = {
  regionCode: string;
  name: string;
  eventCount: number;
};
