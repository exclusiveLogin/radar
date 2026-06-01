import { Injectable } from "@nestjs/common";
import type { WsServerMessage } from "@radar/shared";
import { PlaceStatePoller } from "./place-state.poller";

type Emit = (message: WsServerMessage) => void;

/**
 * Мост между поллерами и WS: хранит emit из MapGateway.
 * Админка (invalidate/replay) дергает flush без инжекта MapGateway — без цикла DI.
 */
@Injectable()
export class MapRealtimeBroadcastService {
  private emit: Emit | null = null;

  constructor(private readonly placePoller: PlaceStatePoller) {}

  /** Привязка broadcast из MapGateway (onModuleInit). */
  bindEmit(emit: Emit): void {
    this.emit = emit;
  }

  /** Снять все активные places с открытых клиентов (не трогает place_status_active). */
  async flushActivePlacesOnMap(): Promise<number> {
    if (!this.emit) return 0;
    return this.placePoller.broadcastActivePlaceDeactivations(this.emit);
  }
}
