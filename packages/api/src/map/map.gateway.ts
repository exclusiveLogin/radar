import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import {
  type OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { wsClientMessageSchema } from "@radar/shared";
import type { WsChannel, WsServerMessage } from "@radar/shared";
import { WebSocket } from "ws";
import type { RawData, Server } from "ws";
import { MapQueryService } from "./map-query.service";
import { MapRealtimeBroadcastService } from "./map-realtime-broadcast.service";
import { MapFoldRealtimePoller } from "./map-fold-realtime.poller";
import { TracksRealtimePoller } from "./tracks-realtime.poller";

const ALL_CHANNELS: WsChannel[] = ["region-state", "place-state", "warnings", "tracks"];

/** Канал, к которому относится серверное сообщение. */
function channelOf(message: WsServerMessage): WsChannel {
  if (message.type === "warning") return "warnings";
  if (message.type === "place-state") return "place-state";
  if (message.type === "tracks-updated") return "tracks";
  return "region-state";
}

/**
 * WebSocket-шлюз карты (path `/ws`): snapshot при подключении,
 * realtime — diff fold snapshot (MapFoldRealtimePoller).
 */
@WebSocketGateway({ path: "/ws" })
export class MapGateway
  implements OnGatewayConnection, OnModuleInit, OnModuleDestroy
{
  @WebSocketServer() server!: Server;

  private readonly subscriptions = new Map<WebSocket, Set<WsChannel>>();

  constructor(
    private readonly map: MapQueryService,
    private readonly foldPoller: MapFoldRealtimePoller,
    private readonly tracksPoller: TracksRealtimePoller,
    private readonly realtime: MapRealtimeBroadcastService,
  ) {}

  onModuleInit(): void {
    const emit = (message: WsServerMessage): void => this.broadcast(message);
    this.realtime.bindEmit(emit);
    this.foldPoller.start(emit);
    this.tracksPoller.start(emit);
  }

  onModuleDestroy(): void {
    this.foldPoller.stop();
    this.tracksPoller.stop();
  }

  async handleConnection(client: WebSocket): Promise<void> {
    this.subscriptions.set(client, new Set(ALL_CHANNELS));
    client.on("message", (raw) => this.onClientMessage(client, raw));
    client.on("close", () => this.subscriptions.delete(client));

    try {
      const regionsState = await this.map.getRegionsStateAt(new Date());
      this.send(client, {
        type: "snapshot",
        payload: {
          generatedAt: regionsState.generatedAt,
          regions: regionsState.regions,
          places: [],
          vicinityScopes: [],
        },
      });
    } catch (error) {
      console.warn("[MapGateway] snapshot on connect failed — empty payload", error);
      this.send(client, {
        type: "snapshot",
        payload: {
          generatedAt: new Date().toISOString(),
          regions: [],
          places: [],
          vicinityScopes: [],
        },
      });
    }
  }

  private onClientMessage(client: WebSocket, raw: RawData): void {
    const parsed = this.parseClientMessage(raw);
    if (!parsed) return;
    const channels = this.subscriptions.get(client) ?? new Set<WsChannel>();
    for (const channel of parsed.channels) {
      if (parsed.type === "subscribe") channels.add(channel);
      else channels.delete(channel);
    }
    this.subscriptions.set(client, channels);
  }

  private parseClientMessage(raw: RawData) {
    try {
      const result = wsClientMessageSchema.safeParse(JSON.parse(raw.toString()));
      return result.success ? result.data : null;
    } catch {
      return null;
    }
  }

  private broadcast(message: WsServerMessage): void {
    const channel = channelOf(message);
    for (const [client, channels] of this.subscriptions) {
      if (client.readyState === WebSocket.OPEN && channels.has(channel)) {
        this.send(client, message);
      }
    }
  }

  private send(client: WebSocket, message: WsServerMessage): void {
    client.send(JSON.stringify(message));
  }
}
