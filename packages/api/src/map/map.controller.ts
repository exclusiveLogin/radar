import { Controller, Get, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  mapSnapshotSchema,
  messageFeedResponseSchema,
  stateChangeEventsResponseSchema,
  statusDictionarySchema,
  sourceMessageResponseSchema,
  warningSchema,
} from "@radar/shared";
import { z } from "zod";
import {
  geoRegionsResponseSchema,
  placesResponseSchema,
  regionGeometrySchema,
} from "./map.dto";
import { MapQueryService } from "./map-query.service";
import { MapRealtimeBroadcastService } from "./map-realtime-broadcast.service";

function parseLimit(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
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
      "Возвращает актуальные статусы регионов, places, предупреждения и layout-тайлы схемы. " +
      "Параметр `since` (ISO8601) ограничивает выборку только записями после указанного времени.",
  })
  @ApiQuery({ name: "since", required: false, description: "ISO8601 cursor — вернуть только изменения после этого времени" })
  @ApiResponse({ status: 200, description: "MapSnapshot (regions + places + warnings + layout)" })
  async snapshot(@Query("since") since?: string) {
    return mapSnapshotSchema.parse(await this.map.getSnapshot(since));
  }

  @Get("geo/regions")
  @ApiOperation({ summary: "Справочник регионов для гео-виджета (метаданные без геометрии)" })
  @ApiResponse({ status: 200, description: "{ regions: GeoRegionRef[] } — regionId, code, name, centroid, bbox" })
  async geoRegions() {
    return geoRegionsResponseSchema.parse({
      regions: await this.map.getGeoRegions(),
    });
  }

  /** GeoJSON контуров субъектов РФ (включая stateLevel grey). */
  @Get("map/regions-geojson")
  @ApiOperation({
    summary: "GeoJSON слой контуров субъектов РФ",
    description: "FeatureCollection полигонов регионов со свойствами regionCode, stateLevel, name. Включает grey-регионы без активного статуса.",
  })
  @ApiResponse({ status: 200, description: "GeoJSON FeatureCollection (полигоны регионов)" })
  async regionsGeoJson() {
    return await this.map.getRegionsGeoJsonLayer();
  }

  /**
   * GeoJSON только активных районов: geo_feature с place_status_read_model.action='raise'.
   * Лёгкий ответ (~единицы объектов) — безопасно вызывать при каждом обновлении places.
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
   * GeoJSON всех районов из geo_feature (layer=district/city_district).
   * Опционально: ?regionId=<uuid> для фильтрации по субъекту.
   */
  @Get("map/districts-geojson")
  @ApiOperation({
    summary: "GeoJSON всех районов (тяжёлый слой)",
    description: "Все geo_feature с layer=district/city_district. Для ленивой подгрузки контуров при клике на регион. Фильтр по regionId (uuid).",
  })
  @ApiQuery({ name: "regionId", required: false, description: "UUID региона — вернуть районы только этого субъекта" })
  @ApiResponse({ status: 200, description: "GeoJSON FeatureCollection (полигоны районов)" })
  async districtsGeoJson(@Query("regionId") regionId?: string) {
    return await this.map.getDistrictsGeoJsonLayer(regionId);
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

  @Get("status-dictionary")
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
  @ApiResponse({ status: 200, description: "{ message: SourceMessage | null }" })
  async regionSourceMessage(@Param("code") code: string) {
    const message = await this.map.getRegionSourceMessage(code);
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

  /** Лента изменений: parsed_event + регионы из event_locations (1 событие = 1 карточка). */
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
    description: "Хронология parsed_events для заданного ISO-кода субъекта.",
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
}
