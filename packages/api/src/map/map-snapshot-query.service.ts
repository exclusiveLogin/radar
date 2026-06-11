import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { DataSource } from "typeorm";
import { In } from "typeorm";
import type { MapPlaceSnapshot, MapRegionSnapshot, MapSnapshot, StateLevel } from "@radar/shared";
import {
  foldMapState,
  maxStateLevel,
  resolveMapStateTtlMs,
} from "@radar/shared";
import { GeoFeatureEntity, PlaceEntity, RegionEntity } from "../geo/entities";
import { StatusDictionaryEntity } from "../events/entities";
import { resolvePlaceMapCentroid, resolveRegionCentroid } from "./map-centroid.resolver";
import { loadLayout } from "./layout.loader";
import { MapFactsRepository } from "./map-facts.repository";

type RegionStateLevel = MapRegionSnapshot["stateLevel"];

function toNumber(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Use-case: fold фактов на asOf + enrich geo/layout → MapSnapshot. */
@Injectable()
export class MapSnapshotQueryService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly factsRepository: MapFactsRepository,
  ) {}

  async getSnapshotAt(asOf: Date): Promise<MapSnapshot> {
    const ttlMs = resolveMapStateTtlMs(process.env);
    const facts = await this.factsRepository.loadFacts(asOf, ttlMs);
    const folded = foldMapState({ asOf, ttlMs, facts });
    const levelByStatus = await this.loadStatusLevels();

    const regions = await this.dataSource.getRepository(RegionEntity).find({
      where: { isActive: true },
      order: { name: "ASC" },
    });
    const winnerByRegionId = new Map(
      folded.regions.map((winner) => [winner.regionId, winner]),
    );
    const placeCentroidByRegion = await this.loadPlaceCentroidByRegion();
    const layout = loadLayout();

    const regionItems: MapRegionSnapshot[] = [];
    for (const region of regions) {
      const winner = winnerByRegionId.get(region.id);
      if (!winner) continue;

      const code = region.iso ?? region.fiasId ?? region.name;
      const tile = layout.tiles[code];
      const centroid = resolveRegionCentroid({
        region,
        placeFallback: placeCentroidByRegion.get(region.id),
      });
      regionItems.push({
        regionId: region.id,
        regionCode: code,
        name: region.name,
        stateLevel: winner.stateLevel as RegionStateLevel,
        activity: 0,
        layout: tile,
        centroidLat: centroid?.lat,
        centroidLon: centroid?.lon,
        statusEventAt: winner.occurredAt,
        statusAction: winner.action,
      });
    }

    const places = await this.buildPlaceSnapshots(folded.places, levelByStatus, asOf);

    return {
      generatedAt: asOf.toISOString(),
      regions: regionItems,
      places,
    };
  }

  private async buildPlaceSnapshots(
    winners: Array<{
      placeId?: string;
      regionId: string;
      regionCode: string;
      statusCode: string;
      stateLevel: StateLevel;
      occurredAt: string;
    }>,
    levelByStatus: Map<string, StateLevel>,
    asOf: Date,
  ): Promise<MapPlaceSnapshot[]> {
    const placeIds = [...new Set(winners.map((w) => w.placeId).filter(Boolean))] as string[];
    if (placeIds.length === 0) return [];

    const places = await this.dataSource.getRepository(PlaceEntity).find({
      where: { id: In(placeIds) },
      relations: { region: true },
    });
    const winnerByPlaceId = new Map(
      winners.filter((w) => w.placeId).map((w) => [w.placeId!, w]),
    );

    const geoFeatureIds = [...new Set(
      places.map((p) => p.geoFeatureId).filter((id): id is string => id != null),
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
    for (const place of places) {
      if (place.kind === "region") continue;
      const winner = winnerByPlaceId.get(place.id);
      if (!winner) continue;

      const regionCode = place.region?.iso ?? place.region?.name ?? winner.regionCode;
      const stateLevel = maxStateLevel([winner.statusCode], levelByStatus);
      if (stateLevel === "grey") continue;

      const geoFeatureCentroid = place.geoFeatureId
        ? geoFeatureMap.get(place.geoFeatureId)
        : undefined;
      const coords = resolvePlaceMapCentroid({ place, geoFeatureCentroid });
      if (!coords) continue;

      items.push({
        placeId: place.id,
        placeName: place.name,
        regionId: place.regionId,
        regionCode,
        statusCode: winner.statusCode,
        stateLevel,
        kind: place.kind,
        geoFeatureId: place.geoFeatureId ?? undefined,
        lat: coords.lat,
        lon: coords.lon,
        updatedAt: asOf.toISOString(),
        statusEventAt: winner.occurredAt,
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
}
