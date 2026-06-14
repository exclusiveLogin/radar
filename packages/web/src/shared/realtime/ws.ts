import { BehaviorSubject, Observable } from "rxjs";
import { wsServerMessageSchema } from "@radar/shared";
import type { WsServerMessage } from "@radar/shared";
import { pushAppLog } from "../state/appLogStore";

export type WsConnectionStatus = "connecting" | "open" | "closed";

/** Текущий статус WS-соединения карты. */
export const connectionStatus$ = new BehaviorSubject<WsConnectionStatus>("connecting");

/** Подключение к WS карты с авто-переподключением; отдаёт валидированные серверные сообщения. */
export function connectMapWs(): Observable<WsServerMessage> {
  return new Observable<WsServerMessage>((subscriber) => {
    let socket: WebSocket | null = null;
    let closedByClient = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryMs = 3000;
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

    let wasOpen = false;

    const open = (): void => {
      connectionStatus$.next("connecting");
      socket = new WebSocket(url);
      socket.onmessage = (event) => {
        try {
          const parsed = wsServerMessageSchema.safeParse(JSON.parse(event.data));
          if (parsed.success) subscriber.next(parsed.data);
        } catch {
          /* игнорируем некорректные кадры */
        }
      };
      socket.onopen = () => {
        retryMs = 3000;
        wasOpen = true;
        connectionStatus$.next("open");
      };
      socket.onclose = () => {
        if (wasOpen && !closedByClient) {
          pushAppLog("warn", "Соединение потеряно, переподключение…", { source: "Realtime" });
        }
        wasOpen = false;
        connectionStatus$.next(closedByClient ? "closed" : "connecting");
        if (!closedByClient) {
          retryTimer = setTimeout(open, retryMs);
          retryMs = Math.min(retryMs * 2, 30_000);
        }
      };
      socket.onerror = () => socket?.close();
    };

    open();
    return () => {
      closedByClient = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
      connectionStatus$.next("closed");
    };
  });
}
