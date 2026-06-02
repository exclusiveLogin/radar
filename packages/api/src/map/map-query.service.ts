import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { DataSource } from "typeorm";
import { In } from "typeorm";
import type {
  MapPlaceSnapshot,
  MapRegionSnapshot,
  MapSnapshot,
  MessageFeedItem,
  StateChangeEventItem,
  StateLevel,
  StatusDictionary,
  Warning,
} from "@radar/shared";
import {
  StatusDictionaryEntity,
} from "../events/entities";
import { PlaceEntity, RegionEntity } from "../geo/entities";
import { resolvePlaceMapCentroid, resolveRegionCentroid } from "./map-centroid.resolver";
import { loadLayout } from "./layout.loader";
import { maxStateLevel } from "@radar/shared";
import type { SourceMessage } from "@radar/shared";
import type { GeoRegionRef, PlaceRef } from "./map.dto";
import {
  RegionGeometryCatalog,
  type RegionsGeoJsonLayer,
} from "./region-geometry.catalog";

type RegionStateLevel = MapRegionSnapshot["stateLevel"];
const REGION_DRAW_SUPPRESS_AGE_MS = 3 * 60 * 60 * 1000;

/** Преобразует numeric-строку TypeORM в число (или undefined). */
function toNumber(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

@Injectable()
export class MapQueryService {
  private catalogBound = false;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Полигоны активных регионов (OSM GeoJSON) + stateLevel из region_state_active. */
  async getRegionsGeoJsonLayer(): Promise<RegionsGeoJsonLayer> {
    await this.ensureCatalogBound();
    const states = await this.loadRegionStateRows();

    const stateByIso = new Map<string, StateLevel>();
    for (const row of states) {
      if (!row.regionCode) continue;
      stateByIso.set(row.regionCode, row.stateLevel as StateLevel);
    }

    // Полный набор контуров: цвет/видимость задаёт клиент по WS snapshot (не режем геометрию).
    return RegionGeometryCatalog.getInstance().buildLayer(stateByIso, {
      includeGrey: true,
    });
  }

  /** Привязка файлов OSM к ISO регионов БД (один раз за процесс). */
  private async ensureCatalogBound(): Promise<void> {
    if (this.catalogBound) return;
    const regions = await this.dataSource.getRepository(RegionEntity).find({
      where: { isActive: true },
    });
    RegionGeometryCatalog.getInstance().bindRegions(
      regions.map((region) => ({
        iso: region.iso,
        name: region.name,
        nameWithType: region.nameWithType,
        geometryArtifactKey: region.geometryArtifactKey,
      })),
    );
    this.catalogBound = true;
  }

  /** Лёгкий снапшот карты: регионы + stateLevel + activity + layout, без полигонов. */
  async getSnapshot(since?: string): Promise<MapSnapshot> {
    const regions = await this.dataSource.getRepository(RegionEntity).find({
      where: { isActive: true },
      order: { name: "ASC" },
    });
    const states = await this.loadRegionStateRows();
    const stateByRegionId = new Map(states.map((s) => [s.regionId, s]));
    const layout = loadLayout();
    const sinceDate = since ? new Date(since) : null;
    const placeCentroidByRegion = await this.loadPlaceCentroidByRegion();
    const levelByStatus = await this.loadStatusLevels();

    const items: MapRegionSnapshot[] = [];
    for (const region of regions) {
      const state = stateByRegionId.get(region.id);
      if (!state) continue;
      if (sinceDate && state.updatedAt <= sinceDate) continue;

      const code = region.iso ?? region.fiasId ?? region.name;
      const tile = layout.tiles[code];
      const centroid = resolveRegionCentroid({
        region,
        placeFallback: placeCentroidByRegion.get(region.id),
      });
      items.push({
        regionId: region.id,
        regionCode: code,
        name: region.name,
        stateLevel: state.stateLevel as RegionStateLevel,
        activity: state.activity ?? 0,
        layout: tile,
        centroidLat: centroid?.lat,
        centroidLon: centroid?.lon,
        statusEventAt: state.statusEventAt?.toISOString(),
      });
    }

    const places = await this.loadMapPlaces(levelByStatus);

    return { generatedAt: new Date().toISOString(), regions: items, places };
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

  /** Фид предупреждений (аккордеон): последние смены состояния регионов. */
  async getWarnings(
    params: { regionId?: string; since?: string; limit: number },
  ): Promise<Warning[]> {
    const rows = (await this.dataSource.query(
      `
      SELECT rm.region_id,
             rm.region_code,
             rm.state_level,
             rm.status_code,
             rm.updated_at,
             rm.winner_occurred_at
      FROM region_status_read_model rm
      WHERE ($1::uuid IS NULL OR rm.region_id = $1::uuid)
        AND ($2::timestamptz IS NULL OR rm.updated_at > $2::timestamptz)
      ORDER BY rm.updated_at DESC
      LIMIT $3
      `,
      [params.regionId ?? null, params.since ?? null, params.limit],
    )) as Array<{
      region_id: string;
      region_code: string;
      state_level: RegionStateLevel;
      status_code: string;
      updated_at: Date;
      winner_occurred_at: Date;
    }>;
    const regionNames = await this.loadRegionNames(rows.map((row) => row.region_id));
    return rows.map((row) => ({
      id: `${row.region_id}:${new Date(row.updated_at).toISOString()}`,
      regionId: row.region_id,
      regionCode: row.region_code,
      regionName: regionNames.get(row.region_id),
      title: this.warningTitle(row.state_level),
      text: row.status_code ?? undefined,
      stateLevel: row.state_level,
      eventAt: new Date(row.winner_occurred_at).toISOString(),
    }));
  }

  /** Средний центроид мест региона — fallback, если у региона нет своего centroid. */
  private async loadPlaceCentroidByRegion(): Promise<
    Map<string, { lat: number; lon: number }>
  > {
    const rows = (await this.dataSource.query(
      `SELECT region_id,
              AVG(centroid_lat::float8) AS lat,
              AVG(centroid_lon::float8) AS lon
       FROM places
       WHERE is_active = true
         AND centroid_lat IS NOT NULL
         AND centroid_lon IS NOT NULL
       GROUP BY region_id`,
    )) as Array<{ region_id: string; lat: string; lon: string }>;

    const map = new Map<string, { lat: number; lon: number }>();
    for (const row of rows) {
      const lat = Number(row.lat);
      const lon = Number(row.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        map.set(row.region_id, { lat, lon });
      }
    }
    return map;
  }

  /** Активные места с координатами и уровнем ≠ grey (для гео-слоя places). */
  private async loadMapPlaces(
    levelByStatus: Map<string, StateLevel>,
  ): Promise<MapPlaceSnapshot[]> {
    const rows = await this.loadPlaceStateRows();

    const byPlace = new Map<
      string,
      {
        place: PlaceEntity;
        regionCode: string;
        statusCodes: string[];
        updatedAt: Date;
        statusEventAt: string | undefined;
      }
    >();

    for (const row of rows) {
      const place = row.place;
      if (!place?.region) continue;

      const regionCode = place.region.iso ?? place.region.name;
      const coords = resolvePlaceMapCentroid({ place });
      if (!coords) continue;

      const rowEventAt = row.statusEventAt;
      const bucket = byPlace.get(place.id) ?? {
        place,
        regionCode,
        statusCodes: [],
        updatedAt: row.updatedAt,
        statusEventAt: rowEventAt,
      };
      bucket.statusCodes.push(row.statusCode);
      if (row.updatedAt > bucket.updatedAt) bucket.updatedAt = row.updatedAt;
      if (rowEventAt && (!bucket.statusEventAt || rowEventAt > bucket.statusEventAt)) {
        bucket.statusEventAt = rowEventAt;
      }
      byPlace.set(place.id, bucket);
    }

    const items: MapPlaceSnapshot[] = [];
    for (const entry of byPlace.values()) {
      const stateLevel = maxStateLevel(entry.statusCodes, levelByStatus);
      if (stateLevel === "grey") continue;

      const coords = resolvePlaceMapCentroid({ place: entry.place });
      if (!coords) continue;

      items.push({
        placeId: entry.place.id,
        placeName: entry.place.name,
        regionId: entry.place.regionId,
        regionCode: entry.regionCode,
        statusCode: entry.statusCodes[0]!,
        stateLevel,
        lat: coords.lat,
        lon: coords.lon,
        updatedAt: entry.updatedAt.toISOString(),
        statusEventAt: entry.statusEventAt,
      });
    }

    return items;
  }

  /** Последнее raw-сообщение, привязанное к региону (по ISO-коду). */
  async getRegionSourceMessage(regionCode: string): Promise<SourceMessage | null> {
    const rows = (await this.dataSource.query(
      `WITH hit AS (
         SELECT rm.id AS raw_id, pe.id AS parsed_id, rm.raw_text, rm.posted_at, c.key AS channel_key
         FROM raw_messages rm
         INNER JOIN channels c ON c.id = rm.channel_id
         INNER JOIN parsed_events pe ON pe.raw_message_id = rm.id AND pe.is_active = true
         INNER JOIN event_locations el ON el.parsed_event_id = pe.id
         INNER JOIN regions r ON r.id = el.region_id
         WHERE r.iso = $1 AND r.is_active = true
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
       INNER JOIN event_locations el2 ON el2.parsed_event_id = hit.parsed_id
       INNER JOIN regions r2 ON r2.id = el2.region_id AND r2.is_active = true
       GROUP BY hit.raw_text, hit.posted_at, hit.channel_key`,
      [regionCode],
    )) as Array<{
      raw_text: string;
      posted_at: Date;
      channel_key: string;
      region_codes: string[];
    }>;

    const row = rows[0];
    if (!row) return null;
    return {
      rawText: row.raw_text,
      postedAt: row.posted_at.toISOString(),
      channelKey: row.channel_key,
      regionCodes: row.region_codes ?? [],
    };
  }

  /** Последнее raw-сообщение, привязанное к населённому пункту. */
  async getPlaceSourceMessage(placeId: string): Promise<SourceMessage | null> {
    const rows = (await this.dataSource.query(
      `WITH hit AS (
         SELECT rm.id AS raw_id, pe.id AS parsed_id, rm.raw_text, rm.posted_at, c.key AS channel_key
         FROM raw_messages rm
         INNER JOIN channels c ON c.id = rm.channel_id
         INNER JOIN parsed_events pe ON pe.raw_message_id = rm.id AND pe.is_active = true
         INNER JOIN event_locations el ON el.parsed_event_id = pe.id
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
       INNER JOIN event_locations el2 ON el2.parsed_event_id = hit.parsed_id
       INNER JOIN regions r2 ON r2.id = el2.region_id AND r2.is_active = true
       GROUP BY hit.raw_text, hit.posted_at, hit.channel_key`,
      [placeId],
    )) as Array<{
      raw_text: string;
      posted_at: Date;
      channel_key: string;
      region_codes: string[];
    }>;

    const row = rows[0];
    if (!row) return null;
    return {
      rawText: row.raw_text,
      postedAt: row.posted_at.toISOString(),
      channelKey: row.channel_key,
      regionCodes: row.region_codes ?? [],
    };
  }

  private async loadStatusLevels(): Promise<Map<string, StateLevel>> {
    const rows = await this.dataSource
      .getRepository(StatusDictionaryEntity)
      .find({ where: { isActive: true } });
    return new Map(rows.map((row) => [row.code, row.stateLevel as StateLevel]));
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

  /**
   * Лента изменений: только parsed_event с event_locations (ISO на карте).
   * Одна строка = одно событие из одного raw, без дублей без региона.
   */
  async getRecentStateChangeEvents(
    limit: number,
  ): Promise<StateChangeEventItem[]> {
    const rows = (await this.dataSource.query(
      `SELECT pe.id AS parsed_event_id,
              rm.id AS raw_message_id,
              c.key AS channel_key,
              c.title AS channel_title,
              rm.posted_at,
              rm.raw_text,
              pe.event_type,
              pe.extras->>'eventCategory' AS event_category,
              sd.state_level,
              array_agg(DISTINCT r.iso ORDER BY r.iso)
                FILTER (WHERE r.iso IS NOT NULL) AS region_codes,
              array_agg(DISTINCT r.name ORDER BY r.name)
                FILTER (WHERE r.name IS NOT NULL) AS region_names
       FROM parsed_events pe
       INNER JOIN raw_messages rm ON rm.id = pe.raw_message_id
       INNER JOIN channels c ON c.id = rm.channel_id
       INNER JOIN event_locations el ON el.parsed_event_id = pe.id
       INNER JOIN regions r ON r.id = el.region_id AND r.is_active = true
       INNER JOIN status_dictionary sd
         ON sd.code = pe.event_type AND sd.is_active = true
       WHERE pe.is_active = true
         AND sd.state_level IS NOT NULL
         AND sd.state_level <> 'grey'
       GROUP BY pe.id, rm.id, c.key, c.title, rm.posted_at, rm.raw_text,
                pe.event_type, pe.extras, sd.state_level
       ORDER BY rm.posted_at DESC
       LIMIT $1`,
      [limit],
    )) as Array<{
      parsed_event_id: string;
      raw_message_id: string;
      channel_key: string;
      channel_title: string | null;
      posted_at: Date;
      raw_text: string;
      event_type: string;
      event_category: string | null;
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
      stateLevel: row.state_level,
      regionCodes: row.region_codes ?? [],
      regionNames: row.region_names ?? [],
    }));
  }

  /** Последние raw_messages всех каналов + parse/уровень для ленты дашборда. */
  async getRecentMessages(limit: number): Promise<MessageFeedItem[]> {
    const rows = (await this.dataSource.query(
      `SELECT rm.id,
              c.key AS channel_key,
              c.title AS channel_title,
              rm.posted_at,
              rm.raw_text,
              rm.ingest_mode,
              pe.event_type,
              pe.extras,
              pe.extras->>'eventCategory' AS event_category,
              sd.state_level,
              COALESCE(
                array_agg(DISTINCT r.iso) FILTER (WHERE r.iso IS NOT NULL),
                '{}'
              ) AS region_codes
       FROM raw_messages rm
       INNER JOIN channels c ON c.id = rm.channel_id
       LEFT JOIN parsed_events pe ON pe.raw_message_id = rm.id AND pe.is_active = true
       LEFT JOIN status_dictionary sd ON sd.code = pe.event_type AND sd.is_active = true
       LEFT JOIN event_locations el ON el.parsed_event_id = pe.id
       LEFT JOIN regions r ON r.id = el.region_id
       GROUP BY rm.id, c.key, c.title, rm.posted_at, rm.raw_text, rm.ingest_mode,
                pe.event_type, pe.extras, pe.extras->>'eventCategory', sd.state_level
       ORDER BY rm.posted_at DESC
       LIMIT $1`,
      [limit],
    )) as Array<{
      id: string;
      channel_key: string;
      channel_title: string | null;
      posted_at: Date;
      raw_text: string;
      ingest_mode: MessageFeedItem["ingestMode"];
      event_type: string | null;
      event_category: string | null;
      state_level: StateLevel | null;
      region_codes: string[];
    }>;

    return rows.map((row) => ({
      id: row.id,
      channelKey: row.channel_key,
      channelTitle: row.channel_title ?? undefined,
      postedAt: row.posted_at.toISOString(),
      rawText: row.raw_text,
      ingestMode: row.ingest_mode,
      eventType: row.event_type ?? undefined,
      eventCategory: row.event_category ?? undefined,
      stateLevel: row.state_level ?? undefined,
      regionCodes: row.region_codes ?? [],
    }));
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

  private async loadRegionStateRows(): Promise<
    Array<{
      regionId: string;
      regionCode: string;
      stateLevel: StateLevel;
      activity: number;
      updatedAt: Date;
      statusEventAt: Date | null;
    }>
  > {
    const rows = (await this.dataSource.query(
      `
      SELECT rm.region_id,
             rm.region_code,
             rm.state_level,
             0::int AS activity,
             rm.updated_at,
             rm.winner_occurred_at AS status_event_at
      FROM region_status_read_model rm
      WHERE NOT (
        rm.state_level IN ('green', 'grey')
        AND rm.winner_occurred_at < $1::timestamptz
      )
      `,
      [new Date(Date.now() - REGION_DRAW_SUPPRESS_AGE_MS).toISOString()],
    )) as Array<{
      region_id: string;
      region_code: string;
      state_level: StateLevel;
      activity: number;
      updated_at: Date;
      status_event_at: Date | null;
    }>;

    return rows.map((row) => ({
      regionId: row.region_id,
      regionCode: row.region_code,
      stateLevel: row.state_level,
      activity: Number(row.activity ?? 0),
      updatedAt: new Date(row.updated_at),
      statusEventAt: row.status_event_at ? new Date(row.status_event_at) : null,
    }));
  }

  private async loadPlaceStateRows(): Promise<
    Array<{
      place: PlaceEntity;
      statusCode: string;
      updatedAt: Date;
      statusEventAt: string | undefined;
    }>
  > {
    const readRows = (await this.dataSource.query(
      `
      SELECT psm.place_id,
             psm.status_code,
             psm.updated_at,
             psm.winner_occurred_at
      FROM place_status_read_model psm
      WHERE psm.action = 'raise'
      `,
    )) as Array<{
      place_id: string;
      status_code: string;
      updated_at: Date;
      winner_occurred_at: Date | null;
    }>;

    const allPlaceIds = [...new Set(readRows.map((row) => row.place_id))];
    if (allPlaceIds.length === 0) return [];

    const places = await this.dataSource.getRepository(PlaceEntity).find({
      where: { id: In(allPlaceIds) },
      relations: { region: true },
    });
    const byPlaceId = new Map(places.map((row) => [row.id, row]));

    const fromRead = readRows
      .map((row) => {
        const place = byPlaceId.get(row.place_id);
        if (!place) return null;
        return {
          place,
          statusCode: row.status_code,
          updatedAt: new Date(row.updated_at),
          statusEventAt: row.winner_occurred_at?.toISOString(),
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    return fromRead;
  }
}
