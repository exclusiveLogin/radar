import { BehaviorSubject, Observable } from "rxjs";
import { adminWsServerMessageSchema } from "@radar/shared";
import type { AdminWsServerMessage } from "@radar/shared";
import { pushAppLog } from "../state/appLogStore";

export type AdminWsStatus = "connecting" | "open" | "closed";

/** Статус соединения админ-WS. */
export const adminWsStatus$ = new BehaviorSubject<AdminWsStatus>("connecting");

/** Подключение к /ws/admin с авто-реконнектом; отдаёт валидированные серверные сообщения. */
export function connectAdminWs(): Observable<AdminWsServerMessage> {
  return new Observable<AdminWsServerMessage>((subscriber) => {
    let socket: WebSocket | null = null;
    let closedByClient = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryMs = 3000;
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/admin`;

    let wasOpen = false;

    const open = (): void => {
      adminWsStatus$.next("connecting");
      socket = new WebSocket(url);
      socket.onmessage = (event) => {
        try {
          const parsed = adminWsServerMessageSchema.safeParse(JSON.parse(event.data));
          if (parsed.success) subscriber.next(parsed.data);
        } catch {
          /* игнорируем некорректные кадры */
        }
      };
      socket.onopen = () => {
        retryMs = 3000;
        wasOpen = true;
        adminWsStatus$.next("open");
      };
      socket.onclose = () => {
        if (wasOpen && !closedByClient) {
          pushAppLog("warn", "Соединение потеряно, переподключение…", { source: "Admin WS" });
        }
        wasOpen = false;
        adminWsStatus$.next(closedByClient ? "closed" : "connecting");
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
      adminWsStatus$.next("closed");
    };
  });
}
