import { Controller, Get, Param, Query } from "@nestjs/common";
import { ReadSideQueryService } from "./read-side-query.service";

@Controller("api")
export class ReadSideController {
  constructor(private readonly readSide: ReadSideQueryService) {}

  @Get("events")
  async events(@Query("limit") limit?: string) {
    const take = Number(limit ?? 100);
    return this.readSide.getEvents(Number.isFinite(take) ? take : 100);
  }

  @Get("events/:id/locations")
  async eventLocations(@Param("id") parsedEventId: string) {
    return this.readSide.getEventLocations(parsedEventId);
  }

  @Get("regions")
  async regions(@Query("limit") limit?: string) {
    const take = Number(limit ?? 500);
    return this.readSide.getRegions(Number.isFinite(take) ? take : 500);
  }

  @Get("admin/parse-attempts")
  async parseAttempts(@Query("limit") limit?: string) {
    const take = Number(limit ?? 200);
    return this.readSide.getParseAttempts(Number.isFinite(take) ? take : 200);
  }

  @Get("admin/geo-sync")
  async geoSyncHistory(@Query("limit") limit?: string) {
    const take = Number(limit ?? 100);
    return this.readSide.getGeoSyncHistory(Number.isFinite(take) ? take : 100);
  }
}
