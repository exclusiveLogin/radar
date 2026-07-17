/**
 * ---
 * layer: api/map/read-model
 * domain: map
 * purpose: Сборка GeoJSON-слоёв карты из read-моделей и каталога геометрии.
 * ---
 */
import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { DataSource } from "typeorm";
import { RegionEntity } from "../geo/entities";
import { RegionGeometryCatalog, type RegionsGeoJsonLayer } from "./region-geometry.catalog";
import { MapSnapshotQueryService } from "./map-snapshot-query.service";

export type DistrictsGeoJsonLayer = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id: string;
    properties: Record<string, string | number | null>;
    geometry: Record<string, unknown>;
  }>;
};

type DistrictRow = {
  id: string;
  name: string;
  layer: string;
  name_stem: string;
  region_id: string | null;
  centroid_lat: number | null;
  centroid_lon: number | null;
  region_iso: string | null;
  geometry: Record<string, unknown>;
};

/** Read-model запросы геометрии, не влияющие на fold состояния карты. */
@Injectable()
export class MapGeoJsonQueryService {
  private catalogBound = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly mapSnapshotQuery: MapSnapshotQueryService,
  ) {}

  /**
   * Активные полигоны районов: geo_feature мест из fold snapshot.
   * Лёгкий ответ — безопасно грузить при каждом place-state WS-событии.
   */
  async getActiveDistrictsGeoJsonLayer(): Promise<DistrictsGeoJsonLayer> {
    try {
      const snapshot = await this.mapSnapshotQuery.getSnapshotAt(new Date());
      const placeIds = snapshot.places.map((place) => place.placeId);
      if (placeIds.length === 0) return { type: "FeatureCollection", features: [] };
      return this.loadActiveDistrictsByPlaceIds(placeIds);
    } catch (error) {
      console.warn("[map] districts-active: fold недоступен (rebuild/heal), пустой слой", error);
      return { type: "FeatureCollection", features: [] };
    }
  }

  /** Полигоны районов по списку placeId из fold read-line. */
  private async loadActiveDistrictsByPlaceIds(placeIds: string[]): Promise<DistrictsGeoJsonLayer> {
    const rows = await this.dataSource.query<DistrictRow[]>(
      `SELECT DISTINCT ON (gf.id)
              gf.id, gf.name, gf.layer, gf.name_stem, gf.region_id,
              gf.centroid_lat::float8 AS centroid_lat, gf.centroid_lon::float8 AS centroid_lon,
              r.iso AS region_iso, gf.geometry
       FROM geo_feature gf
       INNER JOIN (
         SELECT p.id AS place_id,
                COALESCE(
                  p.geo_feature_id,
                  (SELECT l.geo_feature_id FROM place_geo_link l
                   WHERE l.place_id = p.id ORDER BY l.priority ASC, l.geo_feature_id LIMIT 1)
                ) AS gf_id
         FROM places p
         WHERE p.id = ANY($1::uuid[]) AND p.is_active = true
       ) link ON link.gf_id = gf.id
       LEFT JOIN regions r ON r.id = gf.region_id
       WHERE gf.is_active = true AND gf.geometry IS NOT NULL`,
      [placeIds],
    );
    return this.toFeatureCollection(rows);
  }

  /**
   * Контуры районов и городских округов из geo_feature.
   * Фильтр по конкретным полигонам приоритетнее фильтра по региону.
   */
  async getDistrictsGeoJsonLayer(input?: {
    regionId?: string;
    geoFeatureIds?: string[];
  }): Promise<DistrictsGeoJsonLayer> {
    const geoFeatureIds = input?.geoFeatureIds?.filter(Boolean) ?? [];
    if (geoFeatureIds.length > 0) {
      const rows = await this.dataSource.query<DistrictRow[]>(
        `SELECT gf.id, gf.name, gf.layer, gf.name_stem, gf.region_id,
                gf.centroid_lat::float8 AS centroid_lat, gf.centroid_lon::float8 AS centroid_lon,
                r.iso AS region_iso, gf.geometry
         FROM geo_feature gf
         LEFT JOIN regions r ON r.id = gf.region_id
         WHERE gf.id = ANY($1::uuid[]) AND gf.is_active = true AND gf.geometry IS NOT NULL
         ORDER BY r.iso, gf.name`,
        [geoFeatureIds],
      );
      return this.toFeatureCollection(rows);
    }

    if (!input?.regionId) return { type: "FeatureCollection", features: [] };
    const rows = await this.dataSource.query<DistrictRow[]>(
      `SELECT gf.id, gf.name, gf.layer, gf.name_stem, gf.region_id,
              gf.centroid_lat::float8 AS centroid_lat, gf.centroid_lon::float8 AS centroid_lon,
              r.iso AS region_iso, gf.geometry
       FROM geo_feature gf
       LEFT JOIN regions r ON r.id = gf.region_id
       WHERE gf.layer = ANY($1) AND gf.region_id = $2
         AND gf.is_active = true AND gf.geometry IS NOT NULL
       ORDER BY r.iso, gf.name`,
      [["district", "city_district"], input.regionId],
    );
    return this.toFeatureCollection(rows);
  }

  /** Полигоны субъектов по ISO-кодам, без stateLevel. */
  async getRegionsGeoJsonLayer(regionCodes: string[]): Promise<RegionsGeoJsonLayer> {
    await this.ensureCatalogBound();
    return RegionGeometryCatalog.getInstance().buildLayerByCodes(regionCodes);
  }

  /** Привязка OSM-артефактов к ISO регионов БД — один раз за процесс. */
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

  private toFeatureCollection(rows: DistrictRow[]): DistrictsGeoJsonLayer {
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
}
