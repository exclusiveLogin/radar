import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { StatusDictionaryEntity } from "../events/entities";
import { GeoFeatureEntity, PlaceEntity, PlaceGeoLinkEntity, RegionEntity } from "../geo/entities";
import { MapController } from "./map.controller";
import { MapGateway } from "./map.gateway";
import { MapQueryService } from "./map-query.service";
import { MapFoldRealtimePoller } from "./map-fold-realtime.poller";
import { MapStateFoldRepository } from "./map-state-fold.repository";
import { MapStateFoldService } from "./map-state-fold.service";
import { MapRealtimeBroadcastService } from "./map-realtime-broadcast.service";
import { PlaceStatePoller } from "./place-state.poller";
import { RegionStatePoller } from "./region-state.poller";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RegionEntity,
      PlaceEntity,
      GeoFeatureEntity,
      PlaceGeoLinkEntity,
      StatusDictionaryEntity,
    ]),
  ],
  providers: [
    MapStateFoldRepository,
    MapStateFoldService,
    MapFoldRealtimePoller,
    MapQueryService,
    RegionStatePoller,
    PlaceStatePoller,
    MapRealtimeBroadcastService,
    MapGateway,
  ],
  controllers: [MapController],
  exports: [MapRealtimeBroadcastService],
})
export class MapModule {}
