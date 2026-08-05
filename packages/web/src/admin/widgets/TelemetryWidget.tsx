import { Panel, StatTile } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import { telemetry$ } from "../../shared/state/adminStore";
import { formatBytes, formatUptime } from "../format";
import type { ProcessMetrics } from "@radar/shared";

function ProcessTiles({ title, metrics }: { title: string; metrics: ProcessMetrics }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <h4 style={{ margin: "0 0 6px", fontSize: 12, color: "var(--text-muted)" }}>{title}</h4>
      <div className="ds-stat-grid">
        <StatTile label="Heap used" value={formatBytes(metrics.heapUsedBytes)} />
        <StatTile label="Heap total" value={formatBytes(metrics.heapTotalBytes)} />
        <StatTile label="RSS" value={formatBytes(metrics.rssBytes)} />
        <StatTile label="Uptime" value={formatUptime(metrics.uptimeSec)} />
        <StatTile label="CPU user" value={`${metrics.cpuUserSec.toFixed(1)}s`} />
        <StatTile label="CPU sys" value={`${metrics.cpuSystemSec.toFixed(1)}s`} />
      </div>
    </div>
  );
}

/** Телеметрия процессов: heap/cpu/uptime для API и worker (realtime worker через WS). */
export function TelemetryWidget() {
  const telemetry = useObservable(telemetry$, null);

  if (!telemetry) {
    return (
      <Panel title="Телеметрия процессов">
        <p className="ds-muted">Загрузка метрик…</p>
      </Panel>
    );
  }

  return (
    <Panel title="Телеметрия процессов">
      <ProcessTiles title={`API (pid ${telemetry.api.pid})`} metrics={telemetry.api.process} />
      {telemetry.worker.reachable && telemetry.worker.worker ? (
        <ProcessTiles
          title={`Worker (pid ${telemetry.worker.worker.pid})`}
          metrics={telemetry.worker.worker.process}
        />
      ) : (
        <p className="ds-muted">Worker probe недоступен.</p>
      )}
    </Panel>
  );
}
