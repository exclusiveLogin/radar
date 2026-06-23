import { useMemo } from "react";
import { LiveBadgeView, type LiveBadgeKind } from "../shared/ds/LiveBadgeView";
import { useObservable } from "../shared/hooks/useObservable";
import { adminWsStatus$ } from "../shared/realtime/adminWs";

/** Индикатор admin WebSocket (/ws/admin) — тот же бейдж, что LIVE на карте. */
export function AdminWsBadge() {
  const wsStatus = useObservable(adminWsStatus$, "connecting");

  const { kind, label, title, pulse } = useMemo(() => {
    if (wsStatus === "closed") {
      return {
        kind: "error" as LiveBadgeKind,
        label: "OFFLINE",
        title: "Admin WS отключён",
        pulse: false,
      };
    }
    if (wsStatus === "connecting") {
      return {
        kind: "warn" as LiveBadgeKind,
        label: "SYNC",
        title: "Подключение admin WS…",
        pulse: true,
      };
    }
    return {
      kind: "ok" as LiveBadgeKind,
      label: "LIVE",
      title: "Admin WS подключён",
      pulse: true,
    };
  }, [wsStatus]);

  return <LiveBadgeView kind={kind} label={label} title={title} pulse={pulse} />;
}
