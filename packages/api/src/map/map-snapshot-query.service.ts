import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { DataSource } from "typeorm";
import { In } from "typeorm";
import type {
  LayoutTile,
  MapPlaceSnapshot,
  MapPlacesStateResponse,
  MapRegionSnapshot,
  MapRegionTraits,
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
  resolveNeighborRedHighlights,
  type EventLocationFact,
  type MapEntityWinner,
  type VicinityScopeWinner,
} from "@radar/shared";
import { GeoFeatureEntity, PlaceEntity, RegionEntity } from "@radar/persistence";
import { StatusDictionaryEntity } from "@radar/persistence";
import { ParseMaintenanceGate } from "../parse-admin/parse-maintenance.gate";
import { resolvePlaceMapMarkerCoords, resolveRegionCentroid } from "./map-centroid.resolver";
import { loadLayout } from "./layout.loader";
import { MapFactsRepository } from "./map-facts.repository";
import { RegionAdjacencyRepository } from "./region-adjacency.repository";

type RegionStateLevel = MapRegionSnapshot["stateLevel"];

/** Поля региона, не зависящие от происхождения уровня. */
type RegionSnapshotBase = Pick<
  MapRegionSnapshot,
  "regionId" | "regionCode" | "name" | "layout" | "centroidLat" | "centroidLon"
>;

/** Справочные данные для сборки регионов снапшота (загружаются один раз на вызов). */
type RegionRenderContext = {
  regions: RegionEntity[];
  layoutTiles: Record<string, LayoutTile>;
  placeCentroidByRegion: Map<string, { lat: number; lon: number }>;
};

type RegionWinnerMeta = {
  mass: boolean;
  uncertain: boolean;
  eventSubject?: MapRegionSnapshot["eventSubject"];
};

type RegionWinnerMetaMap = Map<string, RegionWinnerMeta>;

function toNumber(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Код региона на карте: ISO, иначе ФИАС, иначе имя (совпадает с layout.json). */
function resolveRegionCode(region: RegionEntity): string {
  return region.iso ?? region.fiasId ?? region.name;
}

/** Use-case: fold фактов на asOf + enrich geo/layout → layered map state. */
@Injectable()
export class MapSnapshotQueryService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly factsRepository: MapFactsRepository,
    private readonly parseMaintenance: ParseMaintenanceGate,
    private readonly regionAdjacency: RegionAdjacencyRepository,
  ) {}

  async getRegionsStateAt(asOf: Date): Promise<MapRegionsStateResponse> {
    return this.parseMaintenance.runRead(() => this.loadRegionsStateAt(asOf));
  }

  async getPlacesStateAt(asOf: Date, regionId?: string): Promise<MapPlacesStateResponse> {
    return this.parseMaintenance.runRead(() => this.loadPlacesStateAt(asOf, regionId));
  }

  async getSnapshotAt(asOf: Date): Promise<MapSnapshot> {
    return this.parseMaintenance.runRead(async () => {
      const [regionsState, placesState, vicinityScopes] = await Promise.all([
        this.loadRegionsStateAt(asOf),
        this.loadPlacesStateAt(asOf),
        this.loadVicinityScopesAt(asOf),
      ]);
      return {
        generatedAt: asOf.toISOString(),
        regions: regionsState.regions,
        places: placesState.places,
        vicinityScopes,
      };
    });
  }

  async getVicinityScopesAt(asOf: Date): Promise<MapVicinityScopeSnapshot[]> {
    return this.parseMaintenance.runRead(() => this.loadVicinityScopesAt(asOf));
  }

  private async loadRegionsStateAt(asOf: Date): Promise<MapRegionsStateResponse> {
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

  private async loadPlacesStateAt(asOf: Date, regionId?: string): Promise<MapPlacesStateResponse> {
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

  private async loadVicinityScopesAt(asOf: Date): Promise<MapVicinityScopeSnapshot[]> {
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
    return this.buildVicinityScopeSnapshots(scopeWinners, levelByStatus, asOf);
  }

  /** Winner уже несёт factId + геометрию — без пере-джойна факта по occurredAt. */
  private buildVicinityScopeSnapshots(
    winners: VicinityScopeWinner[],
    levelByStatus: Map<string, StateLevel>,
    asOf: Date,
  ): MapVicinityScopeSnapshot[] {
    const items: MapVicinityScopeSnapshot[] = [];
    for (const winner of winners) {
      const stateLevel = maxStateLevel([winner.statusCode], levelByStatus);
      if (stateLevel === "grey") continue;
      items.push({
        scopeId: winner.factId,
        regionId: winner.regionId,
        regionCode: winner.regionCode,
        lat: winner.lat,
        lon: winner.lon,
        radiusM: winner.scopeRadiusM,
        stateLevel,
        statusEventAt: winner.occurredAt,
        updatedAt: asOf.toISOString(),
      });
    }
    return items;
  }

  /**
   * Регионы карты: собственные статусы из fold + превентивный yellow у соседей red.
   * Обе ветки идут одним списком, поэтому REST-снапшот, WS-дельты и replay
   * видят одинаковую картину.
   */
  private async buildRegionSnapshots(
    winners: MapEntityWinner[],
    _asOf: Date,
  ): Promise<MapRegionSnapshot[]> {
    const context = await this.loadRegionRenderContext();
    const winnerMeta = await this.loadRegionWinnerMeta(winners);
    const own = this.buildOwnRegionSnapshots(winners, winnerMeta, context);
    const neighborRed = await this.buildNeighborRedSnapshots(own, context);
    return [...own, ...neighborRed];
  }

  /** Справочник активных регионов + всё, что нужно для их отрисовки. */
  private async loadRegionRenderContext(): Promise<RegionRenderContext> {
    const [regions, placeCentroidByRegion] = await Promise.all([
      this.dataSource.getRepository(RegionEntity).find({
        where: { isActive: true },
        order: { name: "ASC" },
      }),
      this.loadPlaceCentroidByRegion(),
    ]);
    return { regions, layoutTiles: loadLayout().tiles, placeCentroidByRegion };
  }

  /** Идентификаторы и геометрия отображения — общие для обеих веток уровня. */
  private buildRegionBase(
    region: RegionEntity,
    context: RegionRenderContext,
  ): RegionSnapshotBase {
    const code = resolveRegionCode(region);
    const centroid = resolveRegionCentroid({
      region,
      placeFallback: context.placeCentroidByRegion.get(region.id),
    });
    return {
      regionId: region.id,
      regionCode: code,
      name: region.name,
      layout: context.layoutTiles[code],
      centroidLat: centroid?.lat,
      centroidLon: centroid?.lon,
    };
  }

  /** Регионы с собственным winner-фактом. */
  private buildOwnRegionSnapshots(
    winners: MapEntityWinner[],
    winnerMeta: RegionWinnerMetaMap,
    context: RegionRenderContext,
  ): MapRegionSnapshot[] {
    const winnerByRegionId = new Map(winners.map((winner) => [winner.regionId, winner]));

    const items: MapRegionSnapshot[] = [];
    for (const region of context.regions) {
      const winner = winnerByRegionId.get(region.id);
      if (!winner) continue;

      const meta = winnerMeta.get(winner.regionId);
      const traits: MapRegionTraits | undefined =
        meta?.mass || meta?.uncertain
          ? { mass: meta.mass || undefined, uncertain: meta.uncertain || undefined }
          : undefined;

      items.push({
        ...this.buildRegionBase(region, context),
        stateLevel: winner.stateLevel as RegionStateLevel,
        activity: 0,
        statusEventAt: winner.occurredAt,
        statusAction: winner.action,
        statusCode: winner.statusCode,
        traits,
        eventSubject: meta?.eventSubject,
        levelReason: "self",
      });
    }
    return items;
  }

  /**
   * Превентивный yellow для соседей красных регионов.
   *
   * Регион без собственных фактов в fold отсутствует, поэтому запись создаётся
   * здесь. Статус источника не наследуется (это не его событие) — только
   * `statusEventAt`, чтобы затухание шло синхронно с угрозой.
   */
  private async buildNeighborRedSnapshots(
    own: MapRegionSnapshot[],
    context: RegionRenderContext,
  ): Promise<MapRegionSnapshot[]> {
    const selfLevelByCode = new Map(own.map((item) => [item.regionCode, item.stateLevel]));
    const highlights = resolveNeighborRedHighlights(
      selfLevelByCode,
      await this.regionAdjacency.load(),
    );
    if (highlights.size === 0) return [];

    const statusEventAtByCode = new Map(
      own.map((item) => [item.regionCode, item.statusEventAt]),
    );

    const items: MapRegionSnapshot[] = [];
    for (const region of context.regions) {
      const sourceCode = highlights.get(resolveRegionCode(region));
      if (!sourceCode) continue;

      items.push({
        ...this.buildRegionBase(region, context),
        stateLevel: "yellow",
        activity: 0,
        statusEventAt: statusEventAtByCode.get(sourceCode),
        levelReason: "neighbor-red",
      });
    }
    return items;
  }

  /** Traits и subject победителя из parsed_event, привязанного к winner fact. */
  private async loadRegionWinnerMeta(
    winners: MapEntityWinner[],
  ): Promise<RegionWinnerMetaMap> {
    if (winners.length === 0) return new Map();

    const regionIds = winners.map((w) => w.regionId);
    const occurredAts = winners.map((w) => w.occurredAt);

    const rows = (await this.dataSource.query(
      `SELECT el.region_id,
              COALESCE((pe.extras->>'mass')::boolean, false) AS mass,
              COALESCE((pe.extras->>'uncertain')::boolean, false) AS uncertain,
              pe.event_subject AS event_subject
       FROM mat_parse_location el
       INNER JOIN mat_parse_event pe ON pe.id = el.parsed_event_id
       WHERE el.region_id = ANY($1::uuid[])
         AND el.occurred_at = ANY($2::timestamptz[])
         AND COALESCE(el.entity_kind, 'region') <> 'place'`,
      [regionIds, occurredAts],
    )) as Array<{
      region_id: string;
      mass: boolean;
      uncertain: boolean;
      event_subject: string | null;
    }>;

    const meta: RegionWinnerMetaMap = new Map();
    for (const row of rows) {
      const subject = row.event_subject;
      meta.set(row.region_id, {
        mass: row.mass,
        uncertain: row.uncertain,
        eventSubject:
          subject === "drone"
          || subject === "rocket"
          || subject === "mws"
          || subject === "aviation"
          || subject === "other"
            ? subject
            : undefined,
      });
    }
    return meta;
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
