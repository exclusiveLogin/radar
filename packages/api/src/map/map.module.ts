import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  RegionStateActiveEntity,
  RegionStateHistoryEntity,
  StatusDictionaryEntity,
} from "../events/entities";
import { PlaceEntity, RegionEntity } from "../geo/entities";
import { MapController } from "./map.controller";
import { MapGateway } from "./map.gateway";
import { MapQueryService } from "./map-query.service";
import { RegionStatePoller } from "./region-state.poller";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RegionEntity,
      PlaceEntity,
      RegionStateActiveEntity,
      RegionStateHistoryEntity,
      StatusDictionaryEntity,
    ]),
  ],
  providers: [MapQueryService, RegionStatePoller, MapGateway],
  controllers: [MapController],
})
export class MapModule {}
