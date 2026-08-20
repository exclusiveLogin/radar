import { useMemo } from "react";
import { Panel, StatusDot } from "../../shared/ds";
import { EventCardHead } from "../../shared/components/EventCardHead";
import { useBehaviorSubject } from "../../shared/hooks/useBehaviorSubject";
import { connectionStatus$ } from "../../shared/realtime/ws";
import {
  countActiveRegions,
  countVisiblePlacesOnMap,
  formatAge,
} from "../../shared/state/derivations";
import {
  lastSnapshotAt$,
  placesById$,
  regionsByCode$,
} from "../../shared/state/mapStore";
import { systemHealth$, workerStatus$ } from "../../shared/state/providersStore";
import type { StateLevel } from "@radar/shared";
import type { WidgetProps } from "../widgetProps";

type RowKind = "ok" | "warn" | "error" | "neutral";

function kindLevel(kind: RowKind): StateLevel {
  if (kind === "ok") return "green";
  if (kind === "warn") return "yellow";
  if (kind === "error") return "red";
  return "grey";
}

/** WS-соединение, DB ready, счётчики активных регионов/мест. */
export function SystemStatusWidget({
  defaultCollapsed = false,
  panelPersistenceKey,
}: WidgetProps) {
  const wsStatus = useBehaviorSubject(connectionStatus$);
  const health = useBehaviorSubject(systemHealth$);
  const workerStatus = useBehaviorSubject(workerStatus$);
  const lastSnapshot = useBehaviorSubject(lastSnapshotAt$);
  const regions = useBehaviorSubject(regionsByCode$);
  const places = useBehaviorSubject(placesById$);

  const activeRegions = useMemo(() => countActiveRegions(regions), [regions]);
  const activePlaces = useMemo(
    () => countVisiblePlacesOnMap(places, regions),
    [places, regions],
  );

  const wsKind: RowKind =
    wsStatus === "open" ? "ok" : wsStatus === "connecting" ? "warn" : "error";
  const wsLabel =
    wsStatus === "open"
      ? "Подключено"
      : wsStatus === "connecting"
        ? "Переподключение…"
        : "Отключено";

  const workerTip = workerStatus?.worker
    ? [
        `Статус: ${workerStatus.worker.status ?? "?"}`,
        `Orchestrator: ${workerStatus.worker.orchestrator.running ? "running" : "stopped"}`,
        `Live inserted: ${workerStatus.worker.ingest.liveInserted ?? 0}`,
        workerStatus.worker.ingest.lastLiveAt
          ? `Последний live: ${workerStatus.worker.ingest.lastLiveAt}`
          : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "Worker недоступен";

  const rows: Array<{
    id: string;
    title: string;
    kind: RowKind;
    label: string;
    tip?: string;
    pulse?: boolean;
    value?: string;
  }> = [
    {
      id: "ws",
      title: "WebSocket",
      kind: wsKind,
      label: wsLabel,
      pulse: wsStatus === "open",
    },
    {
      id: "api",
      title: "API",
      kind: health.apiOk ? "ok" : "error",
      label: health.apiOk ? "OK" : "Недоступен",
    },
    {
      id: "db",
      title: "База данных",
      kind: health.dbReady ? "ok" : "error",
      label: health.dbReady ? "Ready" : "Not ready",
    },
    {
      id: "worker",
      title: "Worker",
      kind: workerStatus?.reachable ? "ok" : "error",
      label: workerStatus?.reachable
        ? `${workerStatus.worker?.status ?? "?"} · live ${workerStatus.worker?.ingest.liveInserted ?? 0}`
        : "Недоступен",
      tip: workerTip,
      pulse: workerStatus?.worker?.orchestrator.running ?? false,
    },
    ...(workerStatus?.worker
      ? [
          {
            id: "ingest",
            title: "Ingest live",
            kind: "neutral" as const,
            label: "",
            value: workerStatus.worker.ingest.lastLiveAt
              ? formatAge(workerStatus.worker.ingest.lastLiveAt)
              : "—",
          },
        ]
      : []),
    {
      id: "snapshot",
      title: "Снапшот",
      kind: "neutral",
      label: "",
      value: formatAge(lastSnapshot),
    },
    {
      id: "regions",
      title: "Активных регионов",
      kind: "neutral",
      label: "",
      value: String(activeRegions),
    },
    {
      id: "places",
      title: "Активных мест",
      kind: "neutral",
      label: "",
      value: String(activePlaces),
    },
  ];

  return (
    <Panel
      title="Система"
      variant="glass"
      collapsible
      defaultCollapsed={defaultCollapsed}
      persistenceKey={panelPersistenceKey}
    >
      <ul className="ds-message-feed">
        {rows.map((row) => (
          <li key={row.id} className="ds-message-feed__item">
            <EventCardHead
              title={row.title}
              level={kindLevel(row.kind)}
              time={row.value}
              timeAction={
                row.label ? (
                  <StatusDot
                    kind={row.kind}
                    label={row.label}
                    tip={row.tip}
                    pulse={row.pulse}
                  />
                ) : undefined
              }
            />
          </li>
        ))}
      </ul>
    </Panel>
  );
}
