import { Panel, StatusDot } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import { statsOverview$, telemetry$ } from "../../shared/state/adminStore";
import { formatDateTime } from "../format";

/** Статусы раннеров worker: orchestrator/ingest + сводка backfill-задач. */
export function WorkerRunnersWidget() {
  const telemetry = useObservable(telemetry$, null);
  const stats = useObservable(statsOverview$, null);
  const worker = telemetry?.worker.worker ?? null;

  return (
    <Panel title="Раннеры worker">
      <div className="ds-metric-row">
        <span className="ds-metric-row__label">Worker probe</span>
        <StatusDot
          kind={telemetry?.worker.reachable ? "ok" : "error"}
          label={telemetry?.worker.reachable ? "доступен" : "недоступен"}
          pulse={telemetry?.worker.reachable}
        />
      </div>
      <div className="ds-metric-row">
        <span className="ds-metric-row__label">Orchestrator</span>
        <StatusDot
          kind={worker?.orchestrator.running ? "ok" : "neutral"}
          label={worker?.orchestrator.running ? "работает" : "остановлен"}
        />
      </div>
      <div className="ds-metric-row">
        <span className="ds-metric-row__label">Providers / bindings</span>
        <span className="ds-metric-row__value">
          {worker ? `${worker.orchestrator.providerCount} / ${worker.orchestrator.bindingCount}` : "—"}
        </span>
      </div>
      <div className="ds-metric-row">
        <span className="ds-metric-row__label">Ingest live / backfill</span>
        <span className="ds-metric-row__value">
          {worker ? `${worker.ingest.liveInserted} / ${worker.ingest.backfillInserted}` : "—"}
        </span>
      </div>
      <div className="ds-metric-row">
        <span className="ds-metric-row__label">Последний live</span>
        <span className="ds-metric-row__value">
          {formatDateTime(worker?.ingest.lastLiveAt ?? null)}
        </span>
      </div>
      {worker?.ingest.lastError && (
        <div className="ds-metric-row">
          <span className="ds-metric-row__label">Ошибка ingest</span>
          <span className="ds-metric-row__value" style={{ color: "var(--status-error)" }}>
            {worker.ingest.lastError}
          </span>
        </div>
      )}
      {stats && (
        <div className="ds-metric-row">
          <span className="ds-metric-row__label">Backfill (run/pend/done/fail/cancel)</span>
          <span className="ds-metric-row__value">
            {stats.backfillJobs.running}/{stats.backfillJobs.pending}/{stats.backfillJobs.completed}/
            {stats.backfillJobs.failed}/{stats.backfillJobs.canceled}
          </span>
        </div>
      )}
    </Panel>
  );
}
