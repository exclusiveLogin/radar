import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { DataSource } from "typeorm";
import { MoreThan } from "typeorm";
import type {
  MapRegionSnapshot,
  MapSnapshot,
  StatusDictionary,
  Warning,
} from "@radar/shared";
import {
  RegionStateActiveEntity,
  RegionStateHistoryEntity,
  StatusDictionaryEntity,
} from "../events/entities";
import { PlaceEntity, RegionEntity } from "../geo/entities";
import { loadLayout } from "./layout.loader";
import type { GeoRegionRef, PlaceRef } from "./map.dto";

type StateLevel = MapRegionSnapshot["stateLevel"];

/** Преобразует numeric-строку TypeORM в число (или undefined). */
function toNumber(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

@Injectable()
export class MapQueryService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Лёгкий снапшот карты: регионы + stateLevel + activity + layout, без полигонов. */
  async getSnapshot(since?: string): Promise<MapSnapshot> {
    const regions = await this.dataSource.getRepository(RegionEntity).find({
      where: { isActive: true },
      order: { name: "ASC" },
    });
    const states = await this.dataSource
      .getRepository(RegionStateActiveEntity)
      .find();
    const stateByRegionId = new Map(states.map((s) => [s.regionId, s]));
    const layout = loadLayout();
    const sinceDate = since ? new Date(since) : null;
    const placeCentroidByRegion = await this.loadPlaceCentroidByRegion();

    const items: MapRegionSnapshot[] = [];
    for (const region of regions) {
      const state = stateByRegionId.get(region.id);
      if (sinceDate && (!state || state.updatedAt <= sinceDate)) continue;

      const code = region.iso ?? region.fiasId ?? region.name;
      const tile = layout.tiles[code];
      const fromRegion = {
        lat: toNumber(region.centroidLat),
        lon: toNumber(region.centroidLon),
      };
      const fromPlaces = placeCentroidByRegion.get(region.id);
      items.push({
        regionId: region.id,
        regionCode: code,
        name: region.name,
        stateLevel: (state?.stateLevel ?? "grey") as StateLevel,
        activity: state?.activity ?? 0,
        layout: tile,
        centroidLat: fromRegion.lat ?? fromPlaces?.lat,
        centroidLon: fromRegion.lon ?? fromPlaces?.lon,
      });
    }

    return { generatedAt: new Date().toISOString(), regions: items };
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
    const rows = await this.dataSource
      .getRepository(RegionStateHistoryEntity)
      .find({
        where: {
          ...(params.regionId ? { regionId: params.regionId } : {}),
          ...(params.since ? { changedAt: MoreThan(new Date(params.since)) } : {}),
        },
        order: { changedAt: "DESC" },
        take: params.limit,
      });
    return rows.map((row) => ({
      id: row.id,
      regionId: row.regionId,
      regionCode: row.regionCode,
      title: this.warningTitle(row.stateLevel),
      text: row.reason ?? undefined,
      stateLevel: row.stateLevel,
      eventAt: row.changedAt.toISOString(),
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

  private warningTitle(level: StateLevel): string {
    const titles: Record<StateLevel, string> = {
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
}
