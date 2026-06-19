import { useEffect, useMemo, useState } from "react";
import { interval } from "rxjs";
import { useObservable } from "../hooks/useObservable";
import { connectionStatus$ } from "../realtime/ws";
import { historicalAsOf$ } from "../state/mapStore";
import { systemHealth$ } from "../state/providersStore";
import { formatDateTime } from "../format/dateTime";

type LiveClockProps = {
  /** Часовой пояс (по умолчанию локальный). */
  timeZone?: string;
};

/** Часы и дата в реальном времени (UTC или локальные). */
export function LiveClock({ timeZone }: LiveClockProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const sub = interval(1000).subscribe(() => setNow(new Date()));
    return () => sub.unsubscribe();
  }, []);

  const timeOpts: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    ...(timeZone ? { timeZone } : {}),
  };
  const dateOpts: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(timeZone ? { timeZone } : {}),
  };

  const time = now.toLocaleTimeString("ru-RU", timeOpts);
  const date = now.toLocaleDateString("ru-RU", dateOpts);
  const tzLabel = timeZone ?? "локальное";

  return (
    <div className="ds-live-clock">
      <div>{time}</div>
      <div className="ds-live-clock__date">
        {date} · {tzLabel}
      </div>
    </div>
  );
}

type LiveBadgeKind = "ok" | "warn" | "error";

/** Индикатор realtime-потока: WS + health API/БД. */
export function LiveBadge() {
  const wsStatus = useObservable(connectionStatus$, "connecting");
  const historicalAsOf = useObservable(historicalAsOf$, null);
  const health = useObservable(systemHealth$, {
    apiOk: false,
    dbReady: false,
    lastCheckAt: null,
  });

  const { kind, label, title, pulse } = useMemo(() => {
    if (historicalAsOf) {
      return {
        kind: "warn" as LiveBadgeKind,
        label: "REPLAY",
        title: `Карта на ${formatDateTime(historicalAsOf)} · WS отключён`,
        pulse: false,
      };
    }

    const healthChecked = health.lastCheckAt !== null;

    if (healthChecked && !health.apiOk) {
      return {
        kind: "error" as LiveBadgeKind,
        label: "OFFLINE",
        title: "API недоступен",
        pulse: false,
      };
    }
    if (wsStatus === "closed") {
      return {
        kind: "error" as LiveBadgeKind,
        label: "OFFLINE",
        title: "WS отключён",
        pulse: false,
      };
    }
    if (!healthChecked || wsStatus === "connecting") {
      return {
        kind: "warn" as LiveBadgeKind,
        label: "SYNC",
        title: healthChecked ? "Переподключение WS…" : "Подключение…",
        pulse: true,
      };
    }
    if (!health.dbReady) {
      return {
        kind: "warn" as LiveBadgeKind,
        label: "LIVE",
        title: "WS подключён · БД не готова",
        pulse: true,
      };
    }
    return {
      kind: "ok" as LiveBadgeKind,
      label: "LIVE",
      title: "WS подключён · API · БД",
      pulse: true,
    };
  }, [health.apiOk, health.dbReady, health.lastCheckAt, historicalAsOf, wsStatus]);

  return (
    <span
      className={`ds-live-badge ds-live-badge--${kind}`}
      title={title}
      aria-label={title}
    >
      <span className={`ds-live-badge__dot${pulse ? " ds-live-badge__dot--pulse" : ""}`} />
      {label}
    </span>
  );
}
