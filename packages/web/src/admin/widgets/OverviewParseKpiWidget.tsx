import { Panel, StatTile } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import { statsOverview$ } from "../../shared/state/adminStore";
import { fmt } from "../components/statsOverviewParts";

/** KPI parse: ok / failed / skipped / события. */
export function OverviewParseKpiWidget() {
  const stats = useObservable(statsOverview$, null);

  if (!stats) {
    return (
      <Panel title="Parse">
        <p className="ds-muted">Загрузка…</p>
      </Panel>
    );
  }

  return (
    <Panel title="Parse">
      <div className="ds-stat-grid">
        <StatTile label="Ok" value={fmt(stats.parseOk)} dotColor="var(--status-ok)" />
        <StatTile
          label="Failed"
          value={fmt(stats.parseFailed)}
          dotColor="var(--status-error)"
        />
        <StatTile label="Skipped" value={fmt(stats.parseSkipped)} />
        <StatTile label="События" value={fmt(stats.parsedEvents)} />
      </div>
    </Panel>
  );
}
