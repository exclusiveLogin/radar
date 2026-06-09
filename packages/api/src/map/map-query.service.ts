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
import { GeoFeatureEntity, PlaceEntity, RegionEntity } from "../geo/entities";
import { resolvePlaceMapCentroid, resolveRegionCentroid } from "./map-centroid.resolver";
import { loadLayout } from "./layout.loader";
import { loadRegionAdjacency } from "./adjacency.loader";
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

  /**
   * Активные полигоны районов: только те geo_feature, у которых есть place
   * с action='raise' в place_status_read_model.
   * Возвращает несколько объектов вместо ~2500 — безопасно грузить при каждом обновлении places.
   */
  async getActiveDistrictsGeoJsonLayer(): Promise<{
    type: "FeatureCollection";
    features: Array<{
      type: "Feature";
      id: string;
      properties: Record<string, string | number | null>;
      geometry: Record<string, unknown>;
    }>;
  }> {
    const rows = (await this.dataSource.query(
      `SELECT DISTINCT ON (gf.id)
              gf.id,
              gf.name,
              gf.layer,
              gf.name_stem,
              gf.region_id,
              gf.centroid_lat::float8 AS centroid_lat,
              gf.centroid_lon::float8 AS centroid_lon,
              r.iso AS region_iso,
              gf.geometry
       FROM geo_feature gf
       INNER JOIN places p ON p.geo_feature_id = gf.id AND p.is_active = true
       INNER JOIN place_status_read_model psm ON psm.place_id = p.id AND psm.action = 'raise'
       LEFT JOIN regions r ON r.id = gf.region_id
       WHERE gf.layer = ANY($1)
         AND gf.is_active = true
         AND gf.geometry IS NOT NULL`,
      [["district", "city_district"]],
    )) as Array<{
      id: string;
      name: string;
      layer: string;
      name_stem: string;
      region_id: string | null;
      centroid_lat: number | null;
      centroid_lon: number | null;
      region_iso: string | null;
      geometry: Record<string, unknown>;
    }>;

    return {
      type: "FeatureCollection",
      features: rows.map((row) => ({
        type: "Feature",
        id: row.id,
        properties: {
          name: row.name,
          nameStem: row.name_stem,
          layer: row.layer,
          regionId: row.region_id,
          regionIso: row.region_iso,
          centroidLat: row.centroid_lat,
          centroidLon: row.centroid_lon,
        },
        geometry: row.geometry,
      })),
    };
  }

  /**
   * Контуры районов и городских округов из geo_feature (layer=district/city_district).
   * Используется для детализированной подсветки карты.
   */
  async getDistrictsGeoJsonLayer(regionId?: string): Promise<{
    type: "FeatureCollection";
    features: Array<{
      type: "Feature";
      id: string;
      properties: Record<string, string | number | null>;
      geometry: Record<string, unknown>;
    }>;
  }> {
    const params: unknown[] = [["district", "city_district"]];
    const regionFilter = regionId ? `AND gf.region_id = $${params.push(regionId)}` : "";

    const rows = (await this.dataSource.query(
      `SELECT gf.id,
              gf.name,
              gf.layer,
              gf.name_stem,
              gf.region_id,
              gf.centroid_lat::float8 AS centroid_lat,
              gf.centroid_lon::float8 AS centroid_lon,
              r.iso AS region_iso,
              gf.geometry
       FROM geo_feature gf
       LEFT JOIN regions r ON r.id = gf.region_id
       WHERE gf.layer = ANY($1)
         AND gf.is_active = true
         AND gf.geometry IS NOT NULL
         ${regionFilter}
       ORDER BY r.iso, gf.name`,
      params,
    )) as Array<{
      id: string;
      name: string;
      layer: string;
      name_stem: string;
      region_id: string | null;
      centroid_lat: number | null;
      centroid_lon: number | null;
      region_iso: string | null;
      geometry: Record<string, unknown>;
    }>;

    return {
      type: "FeatureCollection",
      features: rows.map((row) => ({
        type: "Feature",
        id: row.id,
        properties: {
          name: row.name,
          nameStem: row.name_stem,
          layer: row.layer,
          regionId: row.region_id,
          regionIso: row.region_iso,
          centroidLat: row.centroid_lat,
          centroidLon: row.centroid_lon,
        },
        geometry: row.geometry,
      })),
    };
  }

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
        statusAction: state.statusAction,
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
      // Субъект РФ (kind=region) — только контур, не маркер.
      if (place.kind === "region") continue;

      const regionCode = place.region.iso ?? place.region.name;
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

    // Batch-загрузка centroid из geo_feature для catalog-places (district/city_district),
    // у которых place.centroid_* не заполнены, но geo_feature.centroid_* есть.
    const geoFeatureIds = [...new Set(
      [...byPlace.values()]
        .map((e) => e.place.geoFeatureId)
        .filter((id): id is string => id != null),
    )];
    const geoFeatureMap = new Map<string, { lat: number; lon: number }>();
    if (geoFeatureIds.length > 0) {
      const geoFeatures = await this.dataSource
        .getRepository(GeoFeatureEntity)
        .find({ where: { id: In(geoFeatureIds) } });
      for (const gf of geoFeatures) {
        const lat = toNumber(gf.centroidLat);
        const lon = toNumber(gf.centroidLon);
        if (lat !== undefined && lon !== undefined) {
          geoFeatureMap.set(gf.id, { lat, lon });
        }
      }
    }

    const items: MapPlaceSnapshot[] = [];
    for (const entry of byPlace.values()) {
      const stateLevel = maxStateLevel(entry.statusCodes, levelByStatus);
      if (stateLevel === "grey") continue;

      const geoFeatureCentroid = entry.place.geoFeatureId
        ? geoFeatureMap.get(entry.place.geoFeatureId)
        : undefined;
      const coords = resolvePlaceMapCentroid({ place: entry.place, geoFeatureCentroid });
      if (!coords) continue;

      items.push({
        placeId: entry.place.id,
        placeName: entry.place.name,
        regionId: entry.place.regionId,
        regionCode: entry.regionCode,
        statusCode: entry.statusCodes[0]!,
        stateLevel,
        kind: entry.place.kind,
        geoFeatureId: entry.place.geoFeatureId ?? undefined,
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
              pe.repeat,
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
                pe.event_type, pe.extras, pe.repeat, sd.state_level
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
      repeat: boolean | null;
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
              pe.repeat,
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
                pe.event_type, pe.extras, pe.extras->>'eventCategory', pe.repeat, sd.state_level
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
      repeat: boolean | null;
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
      repeat: row.repeat ?? undefined,
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
      statusAction: "raise" | "clear";
    }>
  > {
    const rows = (await this.dataSource.query(
      `
      SELECT rm.region_id,
             rm.region_code,
             CASE WHEN rm.stale THEN 'grey' ELSE rm.state_level END AS state_level,
             0::int AS activity,
             rm.updated_at,
             rm.winner_occurred_at AS status_event_at,
             rm.action AS status_action
      FROM region_status_read_model rm
      WHERE NOT (
        NOT rm.stale
        AND rm.state_level IN ('green', 'grey')
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
      status_action: "raise" | "clear";
    }>;

    return rows.map((row) => ({
      regionId: row.region_id,
      regionCode: row.region_code,
      stateLevel: row.state_level,
      activity: Number(row.activity ?? 0),
      updatedAt: new Date(row.updated_at),
      statusEventAt: row.status_event_at ? new Date(row.status_event_at) : null,
      statusAction: row.status_action,
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
        AND psm.stale = false
        -- Региональный raise не гасит детальные places; только более свежий clear.
        -- Строго > чтобы НП из того же сообщения (одинаковый timestamp) не подавлялись.
        AND NOT EXISTS (
          SELECT 1
          FROM region_status_read_model rsm
          WHERE rsm.region_id = psm.region_id
            AND rsm.stale = false
            AND rsm.action = 'clear'
            AND rsm.winner_occurred_at > psm.winner_occurred_at
        )
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

  /**
   * Последние сводки ПВО (pvo_report) — только информационные события без влияния на карту.
   * Возвращает отчёты с распарсенными данными из extras.pvo.
   */
  async getPvoReports(limit = 50, since?: string): Promise<PvoReportRow[]> {
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
         FROM parsed_events pe
         JOIN raw_messages rm ON rm.id = pe.raw_message_id
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
  }
  /** Смежность регионов (ISO → соседние ISO) из adjacency.json — для read-side вычисления уровня соседей. */
  getRegionAdjacency(): Record<string, string[]> {
    return loadRegionAdjacency();
  }

  /**
   * Топ-N регионов по количеству danger (red) событий за последние 7 дней.
   * Используется в TopActivityWidget для рейтинга активности.
   */
  async getTopActivityRegions(limit = 10): Promise<TopActivityRow[]> {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const rows = (await this.dataSource.query(
      `SELECT r.iso        AS region_code,
              r.name,
              COUNT(DISTINCT pe.id) AS event_count
       FROM parsed_events pe
       JOIN event_locations el ON el.parsed_event_id = pe.id
       JOIN regions r           ON r.id = el.region_id AND r.is_active = true
       JOIN raw_messages rm     ON rm.id = pe.raw_message_id
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
  }

  /**
   * История событий для конкретного региона: last N parsed_events, влияющих на карту.
   * Используется в RegionDetailWidget для отображения хронологии.
   */
  async getRegionEvents(regionCode: string, limit = 50): Promise<StateChangeEventItem[]> {
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
              sd.state_level,
              array_agg(DISTINCT r.iso ORDER BY r.iso)
                FILTER (WHERE r.iso IS NOT NULL) AS region_codes,
              array_agg(DISTINCT r.name ORDER BY r.name)
                FILTER (WHERE r.name IS NOT NULL) AS region_names
       FROM parsed_events pe
       INNER JOIN raw_messages rm ON rm.id = pe.raw_message_id
       INNER JOIN channels c ON c.id = rm.channel_id
       INNER JOIN event_locations el ON el.parsed_event_id = pe.id
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
      stateLevel: row.state_level,
      regionCodes: row.region_codes ?? [],
      regionNames: row.region_names ?? [],
    }));
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
