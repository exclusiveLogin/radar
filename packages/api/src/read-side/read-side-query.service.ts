import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { DataSource } from "typeorm";
import { EventLocationEntity } from "../events/entities/event-location.entity";
import { ParseAttemptEntity } from "../events/entities/parse-attempt.entity";
import { ParsedEventEntity } from "../events/entities/parsed-event.entity";
import { GeoSyncLogEntity } from "../geo/entities/geo-sync-log.entity";
import { RegionEntity } from "../geo/entities/region.entity";

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
}
