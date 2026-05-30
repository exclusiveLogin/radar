import { Controller, Get, NotFoundException, Param, Query } from "@nestjs/common";
import { ApiQuery } from "@nestjs/swagger";
import {
  mapSnapshotSchema,
  statusDictionarySchema,
  warningSchema,
} from "@radar/shared";
import { z } from "zod";
import {
  geoRegionsResponseSchema,
  placesResponseSchema,
  regionGeometrySchema,
} from "./map.dto";
import { MapQueryService } from "./map-query.service";

function parseLimit(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Read-side карты операционной обстановки. Все ответы валидируются zod-DTO
 * (контракт фронта), геометрия отделена от лёгкого снапшота.
 */
@Controller()
export class MapController {
  constructor(private readonly map: MapQueryService) {}

  @Get("map/snapshot")
  @ApiQuery({ name: "since", required: false })
  async snapshot(@Query("since") since?: string) {
    return mapSnapshotSchema.parse(await this.map.getSnapshot(since));
  }

  @Get("geo/regions")
  async geoRegions() {
    return geoRegionsResponseSchema.parse({
      regions: await this.map.getGeoRegions(),
    });
  }

  /** Тяжёлый GeoJSON-слой полигонов субъектов (только активные stateLevel ≠ grey). */
  @Get("map/regions-geojson")
  async regionsGeoJson() {
    return await this.map.getRegionsGeoJsonLayer();
  }

  @Get("regions/:id/geometry")
  async regionGeometry(@Param("id") id: string) {
    const geometry = await this.map.getRegionGeometry(id);
    if (!geometry) throw new NotFoundException("region not found");
    return regionGeometrySchema.parse(geometry);
  }

  @Get("status-dictionary")
  async statusDictionary() {
    return statusDictionarySchema.parse(await this.map.getStatusDictionary());
  }

  @Get("places")
  @ApiQuery({ name: "regionId", required: false })
  @ApiQuery({ name: "limit", required: false })
  async places(
    @Query("regionId") regionId?: string,
    @Query("limit") limit?: string,
  ) {
    return placesResponseSchema.parse({
      places: await this.map.getPlaces(regionId, parseLimit(limit, 1000)),
    });
  }

  @Get("regions/:id/warnings")
  @ApiQuery({ name: "since", required: false })
  @ApiQuery({ name: "limit", required: false })
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

  @Get("warnings")
  @ApiQuery({ name: "since", required: false })
  @ApiQuery({ name: "limit", required: false })
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
}
