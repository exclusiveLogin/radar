import { useMemo } from "react";
import { Panel, StatusDot } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
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

import type { WidgetProps } from "../widgetProps";

/** WS-соединение, DB ready, счётчики активных регионов/мест. */
export function SystemStatusWidget({ defaultCollapsed = false }: WidgetProps) {
  const wsStatus = useObservable(connectionStatus$, "connecting");
  const health = useObservable(systemHealth$, {
    apiOk: false,
    dbReady: false,
    lastCheckAt: null,
  });
  const workerStatus = useObservable(workerStatus$, null);
  const lastSnapshot = useObservable(lastSnapshotAt$, null);
  const regions = useObservable(regionsByCode$, new Map());
  const places = useObservable(placesById$, new Map());

  const activeRegions = useMemo(() => countActiveRegions(regions), [regions]);
  const activePlaces = useMemo(
    () => countVisiblePlacesOnMap(places, regions),
    [places, regions],
  );

  const wsKind =
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

  return (
    <Panel title="Система" variant="glass" collapsible defaultCollapsed={defaultCollapsed}>
      <div className="ds-metric-row">
        <span className="ds-metric-row__label">WebSocket</span>
        <StatusDot kind={wsKind} label={wsLabel} pulse={wsStatus === "open"} />
      </div>
      <div className="ds-metric-row">
        <span className="ds-metric-row__label">API</span>
        <StatusDot
          kind={health.apiOk ? "ok" : "error"}
          label={health.apiOk ? "OK" : "Недоступен"}
        />
      </div>
      <div className="ds-metric-row">
        <span className="ds-metric-row__label">База данных</span>
        <StatusDot
          kind={health.dbReady ? "ok" : "error"}
          label={health.dbReady ? "Ready" : "Not ready"}
        />
      </div>
      <div className="ds-metric-row">
        <span className="ds-metric-row__label">Worker</span>
        <StatusDot
          kind={workerStatus?.reachable ? "ok" : "error"}
          label={
            workerStatus?.reachable
              ? `${workerStatus.worker?.status ?? "?"} · live ${workerStatus.worker?.ingest.liveInserted ?? 0}`
              : "Недоступен"
          }
          tip={workerTip}
          pulse={workerStatus?.worker?.orchestrator.running ?? false}
        />
      </div>
      {workerStatus?.worker && (
        <div className="ds-metric-row">
          <span className="ds-metric-row__label">Ingest live</span>
          <span className="ds-metric-row__value">
            {workerStatus.worker.ingest.lastLiveAt
              ? formatAge(workerStatus.worker.ingest.lastLiveAt)
              : "—"}
          </span>
        </div>
      )}
      <div className="ds-metric-row">
        <span className="ds-metric-row__label">Снапшот</span>
        <span className="ds-metric-row__value">{formatAge(lastSnapshot)}</span>
      </div>
      <div className="ds-metric-row">
        <span className="ds-metric-row__label">Активных регионов</span>
        <span className="ds-metric-row__value">{activeRegions}</span>
      </div>
      <div className="ds-metric-row">
        <span className="ds-metric-row__label">Активных мест</span>
        <span className="ds-metric-row__value">{activePlaces}</span>
      </div>
    </Panel>
  );
}
