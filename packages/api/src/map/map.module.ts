import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { StatusDictionaryEntity } from "../events/entities";
import { GeoFeatureEntity, PlaceEntity, PlaceGeoLinkEntity, RegionEntity } from "../geo/entities";
import { MapController } from "./map.controller";
import { MapGateway } from "./map.gateway";
import { MapMessageFeedQueryService } from "./map-message-feed-query.service";
import { MapQueryService } from "./map-query.service";
import { MapFoldRealtimePoller } from "./map-fold-realtime.poller";
import { TracksRealtimePoller } from "./tracks-realtime.poller";
import { MapFactsRepository } from "./map-facts.repository";
import { MapGeoJsonQueryService } from "./map-geojson-query.service";
import { MapSnapshotQueryService } from "./map-snapshot-query.service";
import { MapRealtimeBroadcastService } from "./map-realtime-broadcast.service";
import { MapTracksService } from "./map-tracks.service";

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
    MapFactsRepository,
    MapSnapshotQueryService,
    MapGeoJsonQueryService,
    MapMessageFeedQueryService,
    MapFoldRealtimePoller,
    TracksRealtimePoller,
    MapQueryService,
    MapRealtimeBroadcastService,
    MapTracksService,
    MapGateway,
  ],
  controllers: [MapController],
  exports: [MapRealtimeBroadcastService],
})
export class MapModule {}
