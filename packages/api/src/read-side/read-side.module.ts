import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { EventLocationEntity } from "@radar/persistence";
import { ParseAttemptEntity } from "@radar/persistence";
import { ParsedEventEntity } from "@radar/persistence";
import { StatusDictionaryEntity } from "@radar/persistence";
import { GeoSyncLogEntity } from "@radar/persistence";
import { PlaceAliasEntity } from "@radar/persistence";
import { PlaceEntity } from "@radar/persistence";
import { RegionEntity } from "@radar/persistence";
import { ChannelEntity } from "@radar/persistence";
import { RawMessageEntity } from "@radar/persistence";
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
    ]),
  ],
  providers: [ReadSideQueryService],
  controllers: [ReadSideController],
  exports: [ReadSideQueryService],
})
export class ReadSideModule {}
