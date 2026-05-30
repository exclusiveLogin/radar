import { Observable } from "rxjs";
import { wsServerMessageSchema } from "@radar/shared";
import type { WsServerMessage } from "@radar/shared";

/** Подключение к WS карты с авто-переподключением; отдаёт валидированные серверные сообщения. */
export function connectMapWs(): Observable<WsServerMessage> {
  return new Observable<WsServerMessage>((subscriber) => {
    let socket: WebSocket | null = null;
    let closedByClient = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryMs = 3000;
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

    const open = (): void => {
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
      };
      socket.onclose = () => {
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
    };
  });
}
