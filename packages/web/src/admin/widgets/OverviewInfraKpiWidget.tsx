import { Panel, StatTile } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import { statsOverview$ } from "../../shared/state/adminStore";
import { fmt } from "../components/statsOverviewParts";

/** KPI инфра: каналы / providers / BF jobs / places. */
export function OverviewInfraKpiWidget() {
  const stats = useObservable(statsOverview$, null);

  if (!stats) {
    return (
      <Panel title="Инфра">
        <p className="ds-muted">Загрузка…</p>
      </Panel>
    );
  }

  const bf = stats.backfillJobs;
  const bfActive = bf.pending + bf.running;

  return (
    <Panel title="Инфра">
      <div className="ds-stat-grid">
        <StatTile
          label="Каналы"
          value={`${stats.channelsListening}/${stats.channelsTotal}`}
        />
        <StatTile
          label="Providers"
          value={`${stats.providersActive}/${stats.providersTotal}`}
        />
        <StatTile
          label="BF jobs"
          value={bfActive > 0 ? `${bfActive} акт.` : "—"}
          dotColor={bfActive > 0 ? "var(--status-warn)" : undefined}
        />
        <StatTile label="Places" value={fmt(stats.placesCatalogActive)} />
      </div>
    </Panel>
  );
}
