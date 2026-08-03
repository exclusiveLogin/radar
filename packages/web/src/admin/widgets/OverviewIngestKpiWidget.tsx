import { Panel, StatTile } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import { statsOverview$ } from "../../shared/state/adminStore";
import { fmt } from "../components/statsOverviewParts";

/** KPI ingest: raw total / live / backfill / manual. */
export function OverviewIngestKpiWidget() {
  const stats = useObservable(statsOverview$, null);

  if (!stats) {
    return (
      <Panel title="Ingest">
        <p className="ds-muted">Загрузка…</p>
      </Panel>
    );
  }

  return (
    <Panel title="Ingest">
      <div className="ds-stat-grid">
        <StatTile label="Всего raw" value={fmt(stats.rawTotal)} />
        <StatTile label="Live" value={fmt(stats.live)} dotColor="var(--status-ok)" />
        <StatTile label="Backfill" value={fmt(stats.backfill)} />
        <StatTile label="Manual" value={fmt(stats.manual)} />
      </div>
    </Panel>
  );
}
