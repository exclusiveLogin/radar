import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { DataSource } from "typeorm";
import { MoreThan } from "typeorm";
import type {
  MapPlaceSnapshot,
  MapRegionSnapshot,
  MapSnapshot,
  StateLevel,
  StatusDictionary,
  Warning,
} from "@radar/shared";
import {
  PlaceStatusActiveEntity,
  RegionStateActiveEntity,
  RegionStateHistoryEntity,
  StatusDictionaryEntity,
} from "../events/entities";
import { PlaceEntity, RegionEntity } from "../geo/entities";
import { resolveRegionCentroid } from "./map-centroid.resolver";
import { loadLayout } from "./layout.loader";
import { maxStateLevel } from "@radar/shared";
import type { GeoRegionRef, PlaceRef } from "./map.dto";
import {
  RegionGeometryCatalog,
  type RegionsGeoJsonLayer,
} from "./region-geometry.catalog";

type RegionStateLevel = MapRegionSnapshot["stateLevel"];

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
    const states = await this.dataSource
      .getRepository(RegionStateActiveEntity)
      .find();

    const stateByIso = new Map<string, StateLevel>();
    for (const row of states) {
      if (!row.regionCode) continue;
      stateByIso.set(row.regionCode, row.stateLevel as StateLevel);
    }

    // Только активные (≠ grey): ~300 KB вместо ~44 MB — иначе браузер не загружает слой.
    return RegionGeometryCatalog.getInstance().buildLayer(stateByIso);
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
    const states = await this.dataSource
      .getRepository(RegionStateActiveEntity)
      .find();
    const stateByRegionId = new Map(states.map((s) => [s.regionId, s]));
    const layout = loadLayout();
    const sinceDate = since ? new Date(since) : null;
    const placeCentroidByRegion = await this.loadPlaceCentroidByRegion();
    const levelByStatus = await this.loadStatusLevels();

    const items: MapRegionSnapshot[] = [];
    for (const region of regions) {
      const state = stateByRegionId.get(region.id);
      if (sinceDate && (!state || state.updatedAt <= sinceDate)) continue;

      const code = region.iso ?? region.fiasId ?? region.name;
      const tile = layout.tiles[code];
      const centroid = resolveRegionCentroid({
        region,
        code,
        tile,
        layoutCols: layout.cols,
        layoutRows: layout.rows,
        placeFallback: placeCentroidByRegion.get(region.id),
        stateLevel: (state?.stateLevel ?? "grey") as RegionStateLevel,
      });
      items.push({
        regionId: region.id,
        regionCode: code,
        name: region.name,
        stateLevel: (state?.stateLevel ?? "grey") as RegionStateLevel,
        activity: state?.activity ?? 0,
        layout: tile,
        centroidLat: centroid?.lat,
        centroidLon: centroid?.lon,
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

  /** Активные места с координатами и уровнем ≠ grey (для гео-слоя places). */
  private async loadMapPlaces(
    levelByStatus: Map<string, StateLevel>,
  ): Promise<MapPlaceSnapshot[]> {
    const rows = await this.dataSource.getRepository(PlaceStatusActiveEntity).find({
      relations: { place: { region: true } },
    });

    const byPlace = new Map<
      string,
      {
        place: PlaceEntity;
        regionCode: string;
        statusCodes: string[];
        updatedAt: Date;
      }
    >();

    for (const row of rows) {
      const place = row.place;
      if (!place?.region) continue;
      const lat = toNumber(place.centroidLat);
      const lon = toNumber(place.centroidLon);
      if (lat === undefined || lon === undefined) continue;

      const regionCode = place.region.iso ?? place.region.name;
      const bucket = byPlace.get(place.id) ?? {
        place,
        regionCode,
        statusCodes: [],
        updatedAt: row.updatedAt,
      };
      bucket.statusCodes.push(row.statusCode);
      if (row.updatedAt > bucket.updatedAt) bucket.updatedAt = row.updatedAt;
      byPlace.set(place.id, bucket);
    }

    const items: MapPlaceSnapshot[] = [];
    for (const entry of byPlace.values()) {
      const stateLevel = maxStateLevel(entry.statusCodes, levelByStatus);
      if (stateLevel === "grey") continue;

      const lat = toNumber(entry.place.centroidLat)!;
      const lon = toNumber(entry.place.centroidLon)!;
      items.push({
        placeId: entry.place.id,
        placeName: entry.place.name,
        regionId: entry.place.regionId,
        regionCode: entry.regionCode,
        statusCode: entry.statusCodes[0]!,
        stateLevel,
        lat,
        lon,
        updatedAt: entry.updatedAt.toISOString(),
      });
    }

    return items;
  }

  private async loadStatusLevels(): Promise<Map<string, StateLevel>> {
    const rows = await this.dataSource
      .getRepository(StatusDictionaryEntity)
      .find({ where: { isActive: true } });
    return new Map(rows.map((row) => [row.code, row.stateLevel as StateLevel]));
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
}
