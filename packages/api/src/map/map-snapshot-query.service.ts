import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { DataSource } from "typeorm";
import { In } from "typeorm";
import type {
  MapPlaceSnapshot,
  MapPlacesStateResponse,
  MapRegionSnapshot,
  MapRegionsStateResponse,
  MapSnapshot,
  MapVicinityScopeSnapshot,
  StateLevel,
} from "@radar/shared";
import {
  foldPlaceMapState,
  foldRegionMapState,
  foldVicinityScopeMapState,
  maxStateLevel,
  resolveMapStateTtlMs,
  type EventLocationFact,
} from "@radar/shared";
import { GeoFeatureEntity, PlaceEntity, RegionEntity } from "../geo/entities";
import { StatusDictionaryEntity } from "../events/entities";
import { resolvePlaceMapMarkerCoords, resolveRegionCentroid } from "./map-centroid.resolver";
import { loadLayout } from "./layout.loader";
import { MapFactsRepository } from "./map-facts.repository";

type RegionStateLevel = MapRegionSnapshot["stateLevel"];

function toNumber(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Use-case: fold фактов на asOf + enrich geo/layout → layered map state. */
@Injectable()
export class MapSnapshotQueryService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly factsRepository: MapFactsRepository,
  ) {}

  async getRegionsStateAt(asOf: Date): Promise<MapRegionsStateResponse> {
    const ttlMs = resolveMapStateTtlMs(process.env);
    let facts: EventLocationFact[] = [];
    try {
      facts = await this.factsRepository.loadRegionFacts(asOf, ttlMs);
    } catch (error) {
      console.warn("[MapSnapshot] loadRegionFacts failed — empty fold", error);
    }
    const folded = foldRegionMapState({ asOf, ttlMs, facts });
    const regions = await this.buildRegionSnapshots(folded, asOf);
    return {
      generatedAt: asOf.toISOString(),
      regions,
    };
  }

  async getPlacesStateAt(asOf: Date, regionId?: string): Promise<MapPlacesStateResponse> {
    const ttlMs = resolveMapStateTtlMs(process.env);
    let regionFacts: EventLocationFact[] = [];
    let placeFacts: EventLocationFact[] = [];
    try {
      regionFacts = await this.factsRepository.loadRegionFacts(asOf, ttlMs);
      const regionClears = regionFacts.filter(
        (fact) => !fact.placeId && fact.action === "clear" && fact.entityKind !== "place",
      );
      placeFacts = await this.factsRepository.loadPlaceFacts(asOf, ttlMs, regionClears);
    } catch (error) {
      console.warn("[MapSnapshot] loadPlaceFacts failed — empty fold", error);
    }
    const regionWinners = foldRegionMapState({ asOf, ttlMs, facts: regionFacts });
    const placeWinners = foldPlaceMapState({
      asOf,
      ttlMs,
      facts: placeFacts,
      regionWinners,
    });
    const levelByStatus = await this.loadStatusLevels();
    let places = await this.buildPlaceSnapshots(placeWinners, levelByStatus, asOf);
    if (regionId) {
      places = places.filter((place) => place.regionId === regionId);
    }
    return {
      generatedAt: asOf.toISOString(),
      places,
    };
  }

  async getSnapshotAt(asOf: Date): Promise<MapSnapshot> {
    const [regionsState, placesState, vicinityScopes] = await Promise.all([
      this.getRegionsStateAt(asOf),
      this.getPlacesStateAt(asOf),
      this.getVicinityScopesAt(asOf),
    ]);
    return {
      generatedAt: asOf.toISOString(),
      regions: regionsState.regions,
      places: placesState.places,
      vicinityScopes,
    };
  }

  async getVicinityScopesAt(asOf: Date): Promise<MapVicinityScopeSnapshot[]> {
    const ttlMs = resolveMapStateTtlMs(process.env);
    let regionFacts: EventLocationFact[] = [];
    let vicinityFacts: EventLocationFact[] = [];
    try {
      regionFacts = await this.factsRepository.loadRegionFacts(asOf, ttlMs);
      vicinityFacts = await this.factsRepository.loadVicinityFacts(asOf, ttlMs);
    } catch (error) {
      console.warn("[MapSnapshot] loadVicinityFacts failed — empty fold", error);
    }
    const regionWinners = foldRegionMapState({ asOf, ttlMs, facts: regionFacts });
    const scopeWinners = foldVicinityScopeMapState({
      asOf,
      ttlMs,
      facts: vicinityFacts,
      regionWinners,
    });
    const levelByStatus = await this.loadStatusLevels();
    return this.buildVicinityScopeSnapshots(scopeWinners, levelByStatus, asOf, vicinityFacts);
  }

  private buildVicinityScopeSnapshots(
    winners: Array<{
      regionId: string;
      regionCode: string;
      statusCode: string;
      stateLevel: StateLevel;
      occurredAt: string;
    }>,
    levelByStatus: Map<string, StateLevel>,
    asOf: Date,
    facts: EventLocationFact[],
  ): MapVicinityScopeSnapshot[] {
    const items: MapVicinityScopeSnapshot[] = [];
    for (const winner of winners) {
      const scopeFact = facts.find(
        (f) =>
          f.regionId === winner.regionId
          && f.occurredAt === winner.occurredAt
          && f.scopeRadiusM != null
          && f.lat != null
          && f.lon != null,
      );
      if (!scopeFact?.lat || !scopeFact.lon || !scopeFact.scopeRadiusM) continue;
      const stateLevel = maxStateLevel([winner.statusCode], levelByStatus);
      if (stateLevel === "grey") continue;
      items.push({
        scopeId: scopeFact.factId,
        regionId: winner.regionId,
        regionCode: winner.regionCode,
        lat: scopeFact.lat,
        lon: scopeFact.lon,
        radiusM: scopeFact.scopeRadiusM,
        stateLevel,
        statusEventAt: winner.occurredAt,
        updatedAt: asOf.toISOString(),
      });
    }
    return items;
  }

  private async buildRegionSnapshots(
    winners: Array<{
      regionId: string;
      regionCode: string;
      stateLevel: StateLevel;
      action: "raise" | "clear";
      occurredAt: string;
    }>,
    _asOf: Date,
  ): Promise<MapRegionSnapshot[]> {
    const regions = await this.dataSource.getRepository(RegionEntity).find({
      where: { isActive: true },
      order: { name: "ASC" },
    });
    const winnerByRegionId = new Map(winners.map((winner) => [winner.regionId, winner]));
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
    return regionItems;
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

    const effectiveGeoFeatureByPlace = await this.loadEffectiveGeoFeatureIds(placeIds);
    const geoFeatureIds = [...new Set(effectiveGeoFeatureByPlace.values())];
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

      const effectiveGeoFeatureId = effectiveGeoFeatureByPlace.get(place.id);
      const geoFeatureCentroid = effectiveGeoFeatureId
        ? geoFeatureMap.get(effectiveGeoFeatureId)
        : undefined;
      const markerCoords = resolvePlaceMapMarkerCoords({ place, geoFeatureCentroid });
      if (!markerCoords && !geoFeatureCentroid) continue;

      items.push({
        placeId: place.id,
        placeName: place.name,
        regionId: place.regionId,
        regionCode,
        statusCode: winner.statusCode,
        stateLevel,
        kind: place.kind,
        geoFeatureId: effectiveGeoFeatureId,
        lat: markerCoords?.lat ?? geoFeatureCentroid!.lat,
        lon: markerCoords?.lon ?? geoFeatureCentroid!.lon,
        updatedAt: asOf.toISOString(),
        statusEventAt: winner.occurredAt,
      });
    }

    return items;
  }

  /** place.geo_feature_id + place_geo_link — SSOT полигона каталога на карте. */
  private async loadEffectiveGeoFeatureIds(
    placeIds: string[],
  ): Promise<Map<string, string>> {
    if (placeIds.length === 0) return new Map();
    const rows = (await this.dataSource.query(
      `SELECT p.id AS place_id,
              COALESCE(
                p.geo_feature_id,
                (
                  SELECT l.geo_feature_id
                  FROM place_geo_link l
                  WHERE l.place_id = p.id
                  ORDER BY l.priority ASC, l.geo_feature_id
                  LIMIT 1
                )
              ) AS geo_feature_id
       FROM places p
       WHERE p.id = ANY($1::uuid[])`,
      [placeIds],
    )) as Array<{ place_id: string; geo_feature_id: string | null }>;

    const map = new Map<string, string>();
    for (const row of rows) {
      if (row.geo_feature_id) map.set(row.place_id, row.geo_feature_id);
    }
    return map;
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
