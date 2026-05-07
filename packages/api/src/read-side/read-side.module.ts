import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { EventLocationEntity } from "../events/entities";
import { ParseAttemptEntity } from "../events/entities";
import { ParsedEventEntity } from "../events/entities";
import { PlaceStatusActiveEntity } from "../events/entities";
import { PlaceStatusHistoryEntity } from "../events/entities";
import { StatusDictionaryEntity } from "../events/entities";
import { GeoSyncLogEntity } from "../geo/entities";
import { PlaceAliasEntity } from "../geo/entities";
import { PlaceEntity } from "../geo/entities";
import { RegionEntity } from "../geo/entities";
import { ChannelEntity } from "../ingest/entities";
import { RawMessageEntity } from "../ingest/entities";
import { ReadSideController } from "./read-side.controller";
import { ReadSideQueryService } from "./read-side-query.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ParsedEventEntity,
      EventLocationEntity,
      ParseAttemptEntity,
      GeoSyncLogEntity,
      RegionEntity,
      PlaceEntity,
      PlaceAliasEntity,
      StatusDictionaryEntity,
      ChannelEntity,
      RawMessageEntity,
      PlaceStatusActiveEntity,
      PlaceStatusHistoryEntity,
    ]),
  ],
  providers: [ReadSideQueryService],
  controllers: [ReadSideController],
})
export class ReadSideModule {}
