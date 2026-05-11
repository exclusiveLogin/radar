import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { DataSource } from "typeorm";
import { EventLocationEntity } from "../events/entities";
import { ParseAttemptEntity } from "../events/entities";
import { ParsedEventEntity } from "../events/entities";
import { PlaceStatusActiveEntity } from "../events/entities";
import { PlaceStatusHistoryEntity } from "../events/entities";
import { GeoSyncLogEntity } from "../geo/entities";
import { RegionEntity } from "../geo/entities";

function buildStatusWhere(params: {
  placeId?: string;
  statusCode?: string;
}): { placeId?: string; statusCode?: string } {
  return {
    ...(params.placeId ? { placeId: params.placeId } : {}),
    ...(params.statusCode ? { statusCode: params.statusCode } : {}),
  };
}

@Injectable()
export class ReadSideQueryService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async getEvents(limit = 100): Promise<ParsedEventEntity[]> {
    return this.dataSource.getRepository(ParsedEventEntity).find({
      order: { parsedAt: "DESC" },
      take: limit,
    });
  }

  async getRegions(limit = 500): Promise<RegionEntity[]> {
    return this.dataSource.getRepository(RegionEntity).find({
      where: { isActive: true },
      order: { name: "ASC" },
      take: limit,
    });
  }

  async getParseAttempts(limit = 200): Promise<ParseAttemptEntity[]> {
    return this.dataSource.getRepository(ParseAttemptEntity).find({
      order: { createdAt: "DESC" },
      take: limit,
    });
  }

  async getGeoSyncHistory(limit = 100): Promise<GeoSyncLogEntity[]> {
    return this.dataSource.getRepository(GeoSyncLogEntity).find({
      order: { startedAt: "DESC" },
      take: limit,
    });
  }

  async getEventLocations(parsedEventId: string): Promise<EventLocationEntity[]> {
    return this.dataSource.getRepository(EventLocationEntity).find({
      where: { parsedEventId },
    });
  }

  async getPlaceStatuses(params: {
    placeId?: string;
    statusCode?: string;
    limit: number;
  }): Promise<PlaceStatusActiveEntity[]> {
    return this.dataSource.getRepository(PlaceStatusActiveEntity).find({
      where: buildStatusWhere(params),
      order: { updatedAt: "DESC" },
      take: params.limit,
    });
  }

  async getPlaceStatusHistory(params: {
    placeId?: string;
    statusCode?: string;
    limit: number;
  }): Promise<PlaceStatusHistoryEntity[]> {
    return this.dataSource.getRepository(PlaceStatusHistoryEntity).find({
      where: buildStatusWhere(params),
      order: { eventAt: "DESC" },
      take: params.limit,
    });
  }
}
