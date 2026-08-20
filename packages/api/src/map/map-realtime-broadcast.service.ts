import { Injectable } from "@nestjs/common";
import type { PlaceStateEvent, WsServerMessage } from "@radar/shared";
import {
  isParseMaintenanceError,
  ParseMaintenanceGate,
} from "../parse-admin/parse-maintenance.gate";
import { MapQueryService } from "./map-query.service";

type Emit = (message: WsServerMessage) => void;

/**
 * Мост между fold-poller и WS: хранит emit из MapGateway.
 * Админка (invalidate/replay) дергает flush без инжекта MapGateway — без цикла DI.
 */
@Injectable()
export class MapRealtimeBroadcastService {
  private emit: Emit | null = null;

  constructor(
    private readonly mapQuery: MapQueryService,
    private readonly parseMaintenance: ParseMaintenanceGate,
  ) {}

  /** Привязка broadcast из MapGateway (onModuleInit). */
  bindEmit(emit: Emit): void {
    this.emit = emit;
  }

  /** Снять все активные places с открытых клиентов перед operational reset. */
  async flushActivePlacesOnMap(): Promise<number> {
    if (!this.emit || this.parseMaintenance.isPaused()) return 0;
    try {
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
    } catch (error) {
      if (isParseMaintenanceError(error)) return 0;
      throw error;
    }
  }

  /**
   * Полный snapshot fold → WS.
   * Во время parse rebuild (maintenance) — no-op, без 503-шума в логах.
   */
  async pushSnapshotToClients(): Promise<boolean> {
    if (!this.emit || this.parseMaintenance.isPaused()) return false;
    try {
      const snapshot = await this.mapQuery.getSnapshot();
      this.emit({ type: "snapshot", payload: snapshot });
      return true;
    } catch (error) {
      if (isParseMaintenanceError(error)) return false;
      throw error;
    }
  }
}
