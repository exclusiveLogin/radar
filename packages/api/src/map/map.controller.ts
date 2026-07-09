import { BadRequestException, Controller, Get, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  mapSnapshotSchema,
  mapRegionsStateResponseSchema,
  mapPlacesStateResponseSchema,
  messageFeedResponseSchema,
  stateChangeEventsResponseSchema,
  statusDictionarySchema,
  sourceMessageResponseSchema,
  warningSchema,
  eventHeatmapPeriodSchema,
  eventHeatmapResponseSchema,
  eventTypeSchema,
  tracksListQuerySchema,
  tracksListResponseSchema,
  tracksFlowQuerySchema,
  tracksFlowResponseSchema,
  tracksGravityQuerySchema,
  tracksGravityResponseSchema,
  type EventType,
} from "@radar/shared";
import { z } from "zod";
import {
  geoRegionsResponseSchema,
  placesResponseSchema,
  regionGeometrySchema,
} from "./map.dto";
import { MapQueryService } from "./map-query.service";
import { MapRealtimeBroadcastService } from "./map-realtime-broadcast.service";
import { MapTracksService } from "./map-tracks.service";

function parseLimit(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Парсит comma-separated eventTypes для heatmap (пусто — без фильтра). */
function parseHeatmapEventTypes(raw: string | undefined): EventType[] | undefined {
  if (!raw?.trim()) return undefined;
  const tokens = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (tokens.length === 0) return undefined;
  const parsed: EventType[] = [];
  for (const token of tokens) {
    const result = eventTypeSchema.safeParse(token);
    if (!result.success) {
      throw new BadRequestException(`Invalid eventType: ${token}`);
    }
    parsed.push(result.data);
  }
  return parsed;
}

/**
 * Read-side карты операционной обстановки. Все ответы валидируются zod-DTO
 * (контракт фронта), геометрия отделена от лёгкого снапшота.
 */
@ApiTags("map")
@Controller()
export class MapController {
  constructor(
    private readonly map: MapQueryService,
    private readonly mapRealtime: MapRealtimeBroadcastService,
    private readonly mapTracks: MapTracksService,
  ) {}

  /** После operational reset в worker — разослать актуальный snapshot открытым клиентам. */
  @Post("map/push-snapshot")
  @ApiOperation({ summary: "Принудительно разослать map snapshot всем подключённым клиентам по WS" })
  @ApiResponse({ status: 201, description: "pushed=true если хотя бы один клиент подключён" })
  async pushSnapshot(): Promise<{ ok: true; pushed: boolean }> {
    const pushed = await this.mapRealtime.pushSnapshotToClients();
    return { ok: true, pushed };
  }

  @Get("map/snapshot")
  @ApiOperation({
    summary: "Полный снапшот карты",
    description:
      "Без параметров — live fold snapshot(now). " +
      "`asOf` (ISO8601) — historical fold из facts на маркер времени (таймлайн). " +
      "`since` — incremental cursor по updated_at (только live, взаимоисключимо с asOf).",
  })
  @ApiQuery({ name: "since", required: false, description: "ISO8601 cursor — только live snapshot" })
  @ApiQuery({ name: "asOf", required: false, description: "ISO8601 — historical fold на момент времени" })
  @ApiResponse({ status: 200, description: "MapSnapshot (regions + places)" })
  async snapshot(
    @Query("since") since?: string,
    @Query("asOf") asOf?: string,
  ) {
    if (asOf && since) {
      throw new BadRequestException("asOf and since are mutually exclusive");
    }
    if (asOf) {
      const at = new Date(asOf);
      if (!Number.isFinite(at.getTime())) {
        throw new BadRequestException("Invalid asOf datetime");
      }
      return mapSnapshotSchema.parse(await this.map.getSnapshotAt(at));
    }
    return mapSnapshotSchema.parse(await this.map.getSnapshot(since));
  }

  @Get("map/regions-state")
  @ApiOperation({
    summary: "Состояние регионов (fold без places)",
    description: "Лёгкий read-layer для bootstrap карты. Опционально `asOf` для Time Machine.",
  })
  @ApiQuery({ name: "asOf", required: false, description: "ISO8601 — historical fold" })
  @ApiResponse({ status: 200, description: "MapRegionsStateResponse" })
  async regionsState(@Query("asOf") asOf?: string) {
    const at = asOf ? new Date(asOf) : new Date();
    if (!Number.isFinite(at.getTime())) {
      throw new BadRequestException("Invalid asOf datetime");
    }
    return mapRegionsStateResponseSchema.parse(await this.map.getRegionsStateAt(at));
  }

  @Get("map/places-state")
  @ApiOperation({
    summary: "Состояние places (fold без geo polygons)",
    description: "Лёгкий read-layer. Фильтр `regionId` — только places субъекта.",
  })
  @ApiQuery({ name: "asOf", required: false, description: "ISO8601 — historical fold" })
  @ApiQuery({ name: "regionId", required: false, description: "UUID региона" })
  @ApiResponse({ status: 200, description: "MapPlacesStateResponse" })
  async placesState(
    @Query("asOf") asOf?: string,
    @Query("regionId") regionId?: string,
  ) {
    const at = asOf ? new Date(asOf) : new Date();
    if (!Number.isFinite(at.getTime())) {
      throw new BadRequestException("Invalid asOf datetime");
    }
    return mapPlacesStateResponseSchema.parse(await this.map.getPlacesStateAt(at, regionId));
  }

  @Get("geo/regions")
  @ApiOperation({ summary: "Справочник регионов для гео-виджета (метаданные без геометрии)" })
  @ApiResponse({ status: 200, description: "{ regions: GeoRegionRef[] } — regionId, code, name, centroid, bbox" })
  async geoRegions() {
    return geoRegionsResponseSchema.parse({
      regions: await this.map.getGeoRegions(),
    });
  }

  /** GeoJSON контуров субъектов по regionCodes (lazy geo layer). */
  @Get("map/regions-geojson")
  @ApiOperation({
    summary: "GeoJSON контуров субъектов по ISO-кодам",
    description: "Query `regionCodes=RU-MOW,RU-SPE`. Без stateLevel — paint на клиенте. Без codes → 400.",
  })
  @ApiQuery({
    name: "regionCodes",
    required: true,
    description: "Comma-separated ISO коды (RU-XXX)",
  })
  @ApiResponse({ status: 200, description: "GeoJSON FeatureCollection" })
  @ApiResponse({ status: 400, description: "regionCodes required" })
  async regionsGeoJson(@Query("regionCodes") regionCodes?: string) {
    if (!regionCodes?.trim()) {
      throw new BadRequestException("regionCodes query param required (comma-separated ISO codes)");
    }
    const codes = regionCodes.split(",").map((c) => c.trim()).filter(Boolean);
    return await this.map.getRegionsGeoJsonLayer(codes);
  }

  /**
   * @deprecated Используй districts-geojson?geoFeatureIds= или lazy fetch по place-state.
   */
  @Get("map/districts-active-geojson")
  @ApiOperation({
    summary: "GeoJSON активных районов (только с raise-статусом)",
    description: "Лёгкий слой — только районы с action=raise. Безопасно перезапрашивать при каждом place-state WS-событии.",
  })
  @ApiResponse({ status: 200, description: "GeoJSON FeatureCollection (активные полигоны районов)" })
  async activeDistrictsGeoJson() {
    return await this.map.getActiveDistrictsGeoJsonLayer();
  }

  /**
   * GeoJSON районов из geo_feature (layer=district/city_district).
   * Фильтр: regionId и/или geoFeatureIds (comma-separated UUID).
   */
  @Get("map/districts-geojson")
  @ApiOperation({
    summary: "GeoJSON районов (lazy geo layer)",
    description: "Фильтр по regionId (uuid) и/или geoFeatureIds (uuid, comma-separated). Без fold.",
  })
  @ApiQuery({ name: "regionId", required: false, description: "UUID региона" })
  @ApiQuery({ name: "geoFeatureIds", required: false, description: "Comma-separated geo_feature UUID" })
  @ApiResponse({ status: 200, description: "GeoJSON FeatureCollection (полигоны районов)" })
  async districtsGeoJson(
    @Query("regionId") regionId?: string,
    @Query("geoFeatureIds") geoFeatureIds?: string,
  ) {
    const ids = geoFeatureIds
      ? geoFeatureIds.split(",").map((id) => id.trim()).filter(Boolean)
      : undefined;
    return await this.map.getDistrictsGeoJsonLayer({ regionId, geoFeatureIds: ids });
  }

  @Get("regions/:id/geometry")
  @ApiOperation({ summary: "Геометрия региона (ленивая подгрузка)", description: "Возвращает bbox и geometryArtifactKey для подгрузки GeoJSON контура." })
  @ApiParam({ name: "id", description: "regionId (UUID)" })
  @ApiResponse({ status: 200, description: "GeoRegionRef с geometryArtifactKey" })
  @ApiResponse({ status: 404, description: "Регион не найден" })
  async regionGeometry(@Param("id") id: string) {
    const geometry = await this.map.getRegionGeometry(id);
    if (!geometry) throw new NotFoundException("region not found");
    return regionGeometrySchema.parse(geometry);
  }

  @Get("map/status-dictionary")
  @ApiOperation({ summary: "Словарь статусов (stateLevel → label, color)", description: "Справочник уровней опасности для легенды карты. Стабильный эндпоинт — можно кешировать." })
  @ApiResponse({ status: 200, description: "StatusDictionary { levels: { code, label, color }[] }" })
  async statusDictionary() {
    return statusDictionarySchema.parse(await this.map.getStatusDictionary());
  }

  @Get("places")
  @ApiOperation({ summary: "Справочник мест", description: "Список places с координатами центроида. Фильтр по regionId (uuid). По умолчанию limit=1000." })
  @ApiQuery({ name: "regionId", required: false, description: "UUID региона" })
  @ApiQuery({ name: "limit", required: false, description: "Макс. кол-во записей (default 1000)" })
  @ApiResponse({ status: 200, description: "{ places: PlaceRef[] }" })
  async places(
    @Query("regionId") regionId?: string,
    @Query("limit") limit?: string,
  ) {
    return placesResponseSchema.parse({
      places: await this.map.getPlaces(regionId, parseLimit(limit, 1000)),
    });
  }

  @Get("regions/:id/warnings")
  @ApiOperation({ summary: "Предупреждения по региону", description: "Лента предупреждений конкретного субъекта. Cursor-пагинация через `since` (ISO8601). Default limit=100." })
  @ApiParam({ name: "id", description: "regionId (UUID)" })
  @ApiQuery({ name: "since", required: false, description: "ISO8601 cursor" })
  @ApiQuery({ name: "limit", required: false, description: "Макс. кол-во записей (default 100)" })
  @ApiResponse({ status: 200, description: "Warning[]" })
  async regionWarnings(
    @Param("id") id: string,
    @Query("since") since?: string,
    @Query("limit") limit?: string,
  ) {
    const warnings = await this.map.getWarnings({
      regionId: id,
      since,
      limit: parseLimit(limit, 100),
    });
    return z.array(warningSchema).parse(warnings);
  }

  @Get("map/regions/by-code/:code/source-message")
  @ApiOperation({ summary: "Исходное сообщение, породившее статус региона", description: "Возвращает текст raw-сообщения и канал для отображения в боковой панели." })
  @ApiParam({ name: "code", description: "ISO 3166-2:RU код региона, напр. RU-MOW" })
  @ApiQuery({ name: "statusEventAt", required: false, description: "ISO8601 — occurred_at winner-статуса на карте" })
  @ApiResponse({ status: 200, description: "{ message: SourceMessage | null }" })
  async regionSourceMessage(
    @Param("code") code: string,
    @Query("statusEventAt") statusEventAt?: string,
  ) {
    const message = await this.map.getRegionSourceMessage(code, { statusEventAt });
    return sourceMessageResponseSchema.parse({ message });
  }

  @Get("map/places/:placeId/source-message")
  @ApiOperation({ summary: "Исходное сообщение, породившее статус места" })
  @ApiParam({ name: "placeId", description: "placeId (UUID)" })
  @ApiResponse({ status: 200, description: "{ message: SourceMessage | null }" })
  async placeSourceMessage(@Param("placeId") placeId: string) {
    const message = await this.map.getPlaceSourceMessage(placeId);
    return sourceMessageResponseSchema.parse({ message });
  }

  @Get("warnings")
  @ApiOperation({ summary: "Глобальная лента предупреждений (все регионы)", description: "Cursor-пагинация через `since` (ISO8601). Default limit=100." })
  @ApiQuery({ name: "since", required: false, description: "ISO8601 cursor" })
  @ApiQuery({ name: "limit", required: false, description: "Макс. кол-во записей (default 100)" })
  @ApiResponse({ status: 200, description: "Warning[]" })
  async warnings(
    @Query("since") since?: string,
    @Query("limit") limit?: string,
  ) {
    const warnings = await this.map.getWarnings({
      since,
      limit: parseLimit(limit, 100),
    });
    return z.array(warningSchema).parse(warnings);
  }

  /** Лента сырых сообщений (все каналы) для дашборда. */
  @Get("map/messages/recent")
  @ApiOperation({ summary: "Лента последних raw-сообщений", description: "Все каналы, обратная хронология. Default limit=80." })
  @ApiQuery({ name: "limit", required: false, description: "Макс. кол-во записей (default 80)" })
  @ApiResponse({ status: 200, description: "{ items: MessageFeedItem[] }" })
  async recentMessages(@Query("limit") limit?: string) {
    return messageFeedResponseSchema.parse({
      items: await this.map.getRecentMessages(parseLimit(limit, 80)),
    });
  }

  /** Лента изменений: parsed_event + регионы из mat_parse_location (1 событие = 1 карточка). */
  @Get("map/events/recent")
  @ApiOperation({ summary: "Лента последних событий изменения статуса", description: "1 запись = 1 parsed_event с привязанными регионами/НП. Default limit=80." })
  @ApiQuery({ name: "limit", required: false, description: "Макс. кол-во записей (default 80)" })
  @ApiResponse({ status: 200, description: "{ items: StateChangeEvent[] }" })
  async recentStateChangeEvents(@Query("limit") limit?: string) {
    return stateChangeEventsResponseSchema.parse({
      items: await this.map.getRecentStateChangeEvents(parseLimit(limit, 80)),
    });
  }

  @Get("map/pvo-reports")
  @ApiOperation({
    summary: "Сводки ПВО",
    description: "Сводные отчёты о работе ПВО за периоды. Не влияют на карту — только информационная лента.",
  })
  @ApiQuery({ name: "limit", required: false, description: "Макс. кол-во записей (default 50)" })
  @ApiQuery({ name: "since", required: false, description: "ISO timestamp: вернуть только записи после указанной даты" })
  @ApiResponse({ status: 200, description: "{ items: PvoReportRow[] }" })
  async pvoReports(@Query("limit") limit?: string, @Query("since") since?: string) {
    const items = await this.map.getPvoReports(parseLimit(limit, 50), since);
    return { items };
  }

  @Get("map/region-adjacency")
  @ApiOperation({
    summary: "Смежность регионов",
    description: "ISO → список соседних ISO. Используется фронтендом для read-side вычисления уровня соседей.",
  })
  @ApiResponse({ status: 200 })
  getRegionAdjacency() {
    return this.map.getRegionAdjacency();
  }

  @Get("map/regions/top-activity")
  @ApiOperation({
    summary: "Топ регионов по активности",
    description: "Top-N регионов по количеству danger-событий за последние 7 дней.",
  })
  @ApiQuery({ name: "limit", required: false, example: "10" })
  async getTopActivityRegions(@Query("limit") limit?: string) {
    const items = await this.map.getTopActivityRegions(parseLimit(limit, 10));
    return { items };
  }

  @Get("map/regions/by-code/:code/events")
  @ApiOperation({
    summary: "История событий региона",
    description: "Хронология mat_parse_event для заданного ISO-кода субъекта.",
  })
  @ApiParam({ name: "code", example: "RU-BRY" })
  @ApiQuery({ name: "limit", required: false, example: "50" })
  async getRegionEvents(
    @Param("code") code: string,
    @Query("limit") limit?: string,
  ) {
    const items = await this.map.getRegionEvents(code, parseLimit(limit, 50));
    return { items };
  }

  @Get("map/events/heatmap")
  @ApiOperation({
    summary: "Теплокарта raise-событий",
    description:
      "GeoJSON Point + meta. Place-события: el.lat/lon → places.centroid → geo_feature.centroid. " +
      "period=24h|7d|30d|all; until=ISO (replay); eventTypes=fixation,pvo_work,...",
  })
  @ApiQuery({ name: "period", required: false, enum: ["24h", "7d", "30d", "all"] })
  @ApiQuery({ name: "until", required: false, description: "ISO8601 верхняя граница (default now)" })
  @ApiQuery({ name: "limit", required: false, description: "Max точек (default 8000, max 15000)" })
  @ApiQuery({
    name: "eventTypes",
    required: false,
    description: "Фильтр типов: fixation,pvo_work,intercept,...",
  })
  @ApiResponse({ status: 200, description: "FeatureCollection + meta" })
  async eventsHeatmap(
    @Query("period") periodRaw?: string,
    @Query("until") untilRaw?: string,
    @Query("limit") limitRaw?: string,
    @Query("eventTypes") eventTypesRaw?: string,
  ) {
    const periodParsed = eventHeatmapPeriodSchema.safeParse(periodRaw ?? "24h");
    if (!periodParsed.success) {
      throw new BadRequestException("Invalid period (24h|7d|30d|all)");
    }
    let until: Date | undefined;
    if (untilRaw) {
      until = new Date(untilRaw);
      if (!Number.isFinite(until.getTime())) {
        throw new BadRequestException("Invalid until datetime");
      }
    }
    return eventHeatmapResponseSchema.parse(
      await this.map.getEventsHeatmapGeoJson({
        period: periodParsed.data,
        until,
        limit: parseLimit(limitRaw, 8000),
        eventTypes: parseHeatmapEventTypes(eventTypesRaw),
      }),
    );
  }

  // ── Tracking endpoints ────────────────────────────────────────────────────

  /** GET /map/tracks — список L1 треков с опциональными нодами. */
  @Get("map/tracks")
  @ApiOperation({ summary: "L1 треки за период с фильтром по профилю угрозы и asOf" })
  @ApiQuery({ name: "asOf", required: false, description: "ISO8601 cursor (Time Machine)" })
  @ApiQuery({ name: "since", required: false })
  @ApiQuery({ name: "until", required: false })
  @ApiQuery({ name: "status", required: false, enum: ["active", "closed", "stale"] })
  @ApiQuery({ name: "threatProfile", required: false, enum: ["uav", "rocket", "balloon", "unknown"] })
  @ApiQuery({ name: "limit", required: false })
  @ApiQuery({ name: "includeNodes", required: false })
  @ApiResponse({ status: 200, description: "TracksListResponse" })
  async getTracks(@Query() rawQuery: Record<string, string>) {
    const query = tracksListQuerySchema.parse(rawQuery);
    return tracksListResponseSchema.parse(await this.mapTracks.listTracks(query));
  }

  /** GET /map/tracks/flow — L2 flow-коридоры (GeoJSON FeatureCollection). */
  @Get("map/tracks/flow")
  @ApiOperation({ summary: "L2 P2P segment rollup (flow corridors), толщина ∝ weight" })
  @ApiQuery({ name: "asOf", required: false })
  @ApiQuery({ name: "since", required: false })
  @ApiQuery({ name: "until", required: false })
  @ApiQuery({ name: "threatProfile", required: false, enum: ["uav", "rocket", "balloon", "unknown"] })
  @ApiQuery({ name: "minCount", required: false, description: "Мин. число треков через сегмент (default 2)" })
  @ApiQuery({ name: "splitByProfile", required: false })
  @ApiResponse({ status: 200, description: "GeoJSON FeatureCollection flow corridors" })
  async getTracksFlow(@Query() rawQuery: Record<string, string>) {
    const query = tracksFlowQuerySchema.parse(rawQuery);
    return tracksFlowResponseSchema.parse(await this.mapTracks.getTracksFlow(query));
  }

  /** GET /map/tracks/gravity — heatmap гравитации мест (узлы треков по зонам). */
  @Get("map/tracks/gravity")
  @ApiOperation({ summary: "Gravity heatmap — плотность mat_track_node по place/geohash" })
  @ApiQuery({ name: "asOf", required: false })
  @ApiQuery({ name: "since", required: false })
  @ApiQuery({ name: "threatProfile", required: false, enum: ["uav", "rocket", "balloon", "unknown"] })
  @ApiQuery({ name: "geohashPrecision", required: false })
  @ApiResponse({ status: 200, description: "GeoJSON FeatureCollection gravity points" })
  async getTracksGravity(@Query() rawQuery: Record<string, string>) {
    const query = tracksGravityQuerySchema.parse(rawQuery);
    return tracksGravityResponseSchema.parse(await this.mapTracks.getTracksGravity(query));
  }
}
