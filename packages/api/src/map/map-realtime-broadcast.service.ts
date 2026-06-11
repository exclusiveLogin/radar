import { Injectable } from "@nestjs/common";
import type { PlaceStateEvent, WsServerMessage } from "@radar/shared";
import { MapQueryService } from "./map-query.service";

type Emit = (message: WsServerMessage) => void;

/**
 * Мост между fold-poller и WS: хранит emit из MapGateway.
 * Админка (invalidate/replay) дергает flush без инжекта MapGateway — без цикла DI.
 */
@Injectable()
export class MapRealtimeBroadcastService {
  private emit: Emit | null = null;

  constructor(private readonly mapQuery: MapQueryService) {}

  /** Привязка broadcast из MapGateway (onModuleInit). */
  bindEmit(emit: Emit): void {
    this.emit = emit;
  }

  /** Снять все активные places с открытых клиентов перед operational reset. */
  async flushActivePlacesOnMap(): Promise<number> {
    if (!this.emit) return 0;
    const snapshot = await this.mapQuery.getSnapshot();
    let sent = 0;
    for (const place of snapshot.places) {
      const payload: PlaceStateEvent = {
        placeId: place.placeId,
        placeName: place.placeName,
        regionId: place.regionId,
        regionCode: place.regionCode,
        statusCode: place.statusCode,
        stateLevel: place.stateLevel,
        action: "deactivate",
        kind: place.kind,
        geoFeatureId: place.geoFeatureId,
        lat: place.lat,
        lon: place.lon,
        changedAt: new Date().toISOString(),
      };
      this.emit({ type: "place-state", payload });
      sent += 1;
    }
    return sent;
  }

  /** Полный snapshot из fold всем WS-клиентам (после clear:pipeline / clear:archive). */
  async pushSnapshotToClients(): Promise<boolean> {
    if (!this.emit) return false;
    const snapshot = await this.mapQuery.getSnapshot();
    this.emit({ type: "snapshot", payload: snapshot });
    return true;
  }
}
