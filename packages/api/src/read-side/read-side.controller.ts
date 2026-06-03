import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from "@nestjs/swagger";
import { ReadSideQueryService } from "./read-side-query.service";

function parseLimit(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Дебаг / legacy read-side эндпоинты.
 * Часть из них заменена актуальными аналогами в MapController и AdminController.
 */
@ApiTags("debug")
@Controller()
export class ReadSideController {
  constructor(private readonly readSide: ReadSideQueryService) {}

  /**
   * @deprecated Используй GET /map/events/recent
   */
  @Get("events")
  @ApiOperation({
    summary: "[DEPRECATED] Лента parsed_events",
    description: "Заменён на GET /map/events/recent (с region/place контекстом).",
    deprecated: true,
  })
  @ApiQuery({ name: "limit", required: false, schema: { type: "integer", default: 100, minimum: 1 } })
  async events(@Query("limit") limit?: string) {
    return this.readSide.getEvents(parseLimit(limit, 100));
  }

  /**
   * @deprecated Дебаг-эндпоинт; в продуктовом UI не используется.
   */
  @Get("events/:id/locations")
  @ApiOperation({
    summary: "[DEPRECATED] event_locations по parsed_event",
    description: "Сырые event_locations одного события. Только для отладки.",
    deprecated: true,
  })
  @ApiParam({ name: "id", description: "parsedEventId (UUID)" })
  async eventLocations(@Param("id") parsedEventId: string) {
    return this.readSide.getEventLocations(parsedEventId);
  }

  /**
   * @deprecated Используй GET /geo/regions (метаданные) или GET /map/snapshot (со статусами).
   * Геометрия (centroid/bbox/geometryArtifactKey) не заполняется в новом geo-pipeline.
   */
  @Get("regions")
  @ApiOperation({
    summary: "[DEPRECATED] Raw-дамп таблицы regions",
    description:
      "Прямой дамп RegionEntity без геометрии. " +
      "Используй GET /geo/regions для метаданных или GET /map/snapshot для статусов.",
    deprecated: true,
  })
  @ApiQuery({ name: "limit", required: false, schema: { type: "integer", default: 500, minimum: 1 } })
  async regions(@Query("limit") limit?: string) {
    return this.readSide.getRegions(parseLimit(limit, 500));
  }

  @Get("admin/parse-attempts")
  @ApiOperation({ summary: "Попытки парсинга (admin)", description: "Лента ParseAttempt с результатом и каналом." })
  @ApiQuery({ name: "limit", required: false, schema: { type: "integer", default: 200, minimum: 1 } })
  @ApiQuery({ name: "status", required: false, schema: { type: "string", enum: ["ok", "failed", "skipped"] } })
  @ApiQuery({ name: "channelKey", required: false, schema: { type: "string" } })
  async parseAttempts(
    @Query("limit") limit?: string,
    @Query("status") status?: "ok" | "failed" | "skipped",
    @Query("channelKey") channelKey?: string,
  ) {
    return this.readSide.getParseAttempts({
      limit: parseLimit(limit, 200),
      status,
      channelKey,
    });
  }

  @Get("admin/stats/overview")
  @ApiOperation({ summary: "Глобальные агрегаты для админ-дашборда" })
  async statsOverview() {
    return this.readSide.getStatsOverview();
  }

  @Get("admin/geo-sync")
  @ApiOperation({ summary: "История geo-sync (admin)", description: "Лог синхронизаций GeoSyncLog." })
  @ApiQuery({ name: "limit", required: false, schema: { type: "integer", default: 100, minimum: 1 } })
  async geoSyncHistory(@Query("limit") limit?: string) {
    return this.readSide.getGeoSyncHistory(parseLimit(limit, 100));
  }

  /**
   * @deprecated Используй GET /map/snapshot — содержит places со статусами.
   */
  @Get("places/status")
  @ApiOperation({
    summary: "[DEPRECATED] place_status_read_model (raw)",
    description: "Прямой дамп place_status_read_model. Используй GET /map/snapshot.",
    deprecated: true,
  })
  @ApiQuery({ name: "placeId", required: false, schema: { type: "string", format: "uuid" } })
  @ApiQuery({ name: "statusCode", required: false, schema: { type: "string" } })
  @ApiQuery({ name: "limit", required: false, schema: { type: "integer", default: 500, minimum: 1 } })
  async placeStatus(
    @Query("placeId") placeId?: string,
    @Query("statusCode") statusCode?: string,
    @Query("limit") limit?: string,
  ) {
    return this.readSide.getPlaceStatuses({
      placeId,
      statusCode,
      limit: parseLimit(limit, 500),
    });
  }

  /**
   * @deprecated Дебаг-эндпоинт; история статусов места без бизнес-логики.
   */
  @Get("places/status/history")
  @ApiOperation({
    summary: "[DEPRECATED] История статусов места (raw)",
    description: "Сырая история place_status_read_model. Только для отладки.",
    deprecated: true,
  })
  @ApiQuery({ name: "placeId", required: false, schema: { type: "string", format: "uuid" } })
  @ApiQuery({ name: "statusCode", required: false, schema: { type: "string" } })
  @ApiQuery({ name: "limit", required: false, schema: { type: "integer", default: 1000, minimum: 1 } })
  async placeStatusHistory(
    @Query("placeId") placeId?: string,
    @Query("statusCode") statusCode?: string,
    @Query("limit") limit?: string,
  ) {
    return this.readSide.getPlaceStatusHistory({
      placeId,
      statusCode,
      limit: parseLimit(limit, 1000),
    });
  }
}
