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
import { RegionStatePoller } from "./region-state.poller";

const ALL_CHANNELS: WsChannel[] = ["region-state", "warnings"];

/** Канал, к которому относится серверное сообщение. */
function channelOf(message: WsServerMessage): WsChannel {
  return message.type === "warning" ? "warnings" : "region-state";
}

/**
 * WebSocket-шлюз карты (path `/ws`): отдаёт snapshot при подключении,
 * принимает subscribe/unsubscribe и транслирует смены состояния/предупреждения
 * подписанным клиентам. Источник realtime — RegionStatePoller (region_state_history).
 */
@WebSocketGateway({ path: "/ws" })
export class MapGateway
  implements OnGatewayConnection, OnModuleInit, OnModuleDestroy
{
  @WebSocketServer() server!: Server;

  private readonly subscriptions = new Map<WebSocket, Set<WsChannel>>();

  constructor(
    private readonly map: MapQueryService,
    private readonly poller: RegionStatePoller,
  ) {}

  onModuleInit(): void {
    this.poller.start((message) => this.broadcast(message));
  }

  onModuleDestroy(): void {
    this.poller.stop();
  }

  async handleConnection(client: WebSocket): Promise<void> {
    this.subscriptions.set(client, new Set(ALL_CHANNELS));
    client.on("message", (raw) => this.onClientMessage(client, raw));
    client.on("close", () => this.subscriptions.delete(client));

    const snapshot = await this.map.getSnapshot();
    this.send(client, { type: "snapshot", payload: snapshot });
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
