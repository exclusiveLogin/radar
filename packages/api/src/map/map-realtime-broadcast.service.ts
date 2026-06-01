import { Injectable } from "@nestjs/common";
import type { WsServerMessage } from "@radar/shared";
import { MapQueryService } from "./map-query.service";
import { PlaceStatePoller } from "./place-state.poller";

type Emit = (message: WsServerMessage) => void;

/**
 * Мост между поллерами и WS: хранит emit из MapGateway.
 * Админка (invalidate/replay) дергает flush без инжекта MapGateway — без цикла DI.
 */
@Injectable()
export class MapRealtimeBroadcastService {
  private emit: Emit | null = null;

  constructor(
    private readonly placePoller: PlaceStatePoller,
    private readonly mapQuery: MapQueryService,
  ) {}

  /** Привязка broadcast из MapGateway (onModuleInit). */
  bindEmit(emit: Emit): void {
    this.emit = emit;
  }

  /** Снять все активные places с открытых клиентов (не трогает place_status_active). */
  async flushActivePlacesOnMap(): Promise<number> {
    if (!this.emit) return 0;
    return this.placePoller.broadcastActivePlaceDeactivations(this.emit);
  }

  /** Полный snapshot из БД всем WS-клиентам (после clear:pipeline / clear:archive). */
  async pushSnapshotToClients(): Promise<boolean> {
    if (!this.emit) return false;
    const snapshot = await this.mapQuery.getSnapshot();
    this.emit({ type: "snapshot", payload: snapshot });
    return true;
  }
}
