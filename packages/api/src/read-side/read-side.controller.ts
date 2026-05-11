import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiQuery } from "@nestjs/swagger";
import { ReadSideQueryService } from "./read-side-query.service";

@Controller()
export class ReadSideController {
  constructor(private readonly readSide: ReadSideQueryService) {}@Get("events")
  @ApiQuery({
    name: "limit",
    required: false,
    schema: { type: "integer", default: 100, minimum: 1 },
  })
  async events(@Query("limit") limit?: string) {
    const take = Number(limit ?? 100);
    return this.readSide.getEvents(Number.isFinite(take) ? take : 100);
  }@Get("events/:id/locations")
  async eventLocations(@Param("id") parsedEventId: string) {
    return this.readSide.getEventLocations(parsedEventId);
  }@Get("regions")
  @ApiQuery({
    name: "limit",
    required: false,
    schema: { type: "integer", default: 500, minimum: 1 },
  })
  async regions(@Query("limit") limit?: string) {
    const take = Number(limit ?? 500);
    return this.readSide.getRegions(Number.isFinite(take) ? take : 500);
  }@Get("admin/parse-attempts")
  @ApiQuery({
    name: "limit",
    required: false,
    schema: { type: "integer", default: 200, minimum: 1 },
  })
  async parseAttempts(@Query("limit") limit?: string) {
    const take = Number(limit ?? 200);
    return this.readSide.getParseAttempts(Number.isFinite(take) ? take : 200);
  }@Get("admin/geo-sync")
  @ApiQuery({
    name: "limit",
    required: false,
    schema: { type: "integer", default: 100, minimum: 1 },
  })
  async geoSyncHistory(@Query("limit") limit?: string) {
    const take = Number(limit ?? 100);
    return this.readSide.getGeoSyncHistory(Number.isFinite(take) ? take : 100);
  }@Get("places/status")
  @ApiQuery({
    name: "placeId",
    required: false,
    schema: { type: "string", format: "uuid" },
  })
  @ApiQuery({
    name: "statusCode",
    required: false,
    schema: { type: "string" },
  })
  @ApiQuery({
    name: "limit",
    required: false,
    schema: { type: "integer", default: 500, minimum: 1 },
  })
  async placeStatus(
    @Query("placeId") placeId?: string,
    @Query("statusCode") statusCode?: string,
    @Query("limit") limit?: string,
  ) {
    const take = Number(limit ?? 500);
    return this.readSide.getPlaceStatuses({
      placeId,
      statusCode,
      limit: Number.isFinite(take) ? take : 500,
    });
  }@Get("places/status/history")
  @ApiQuery({
    name: "placeId",
    required: false,
    schema: { type: "string", format: "uuid" },
  })
  @ApiQuery({
    name: "statusCode",
    required: false,
    schema: { type: "string" },
  })
  @ApiQuery({
    name: "limit",
    required: false,
    schema: { type: "integer", default: 1000, minimum: 1 },
  })
  async placeStatusHistory(
    @Query("placeId") placeId?: string,
    @Query("statusCode") statusCode?: string,
    @Query("limit") limit?: string,
  ) {
    const take = Number(limit ?? 1000);
    return this.readSide.getPlaceStatusHistory({
      placeId,
      statusCode,
      limit: Number.isFinite(take) ? take : 1000,
    });
  }
}
