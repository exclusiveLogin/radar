import { Panel, StatTile } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import { statsOverview$ } from "../../shared/state/adminStore";
import { formatDateTime } from "../format";

/** Глобальные счётчики сообщений/событий/каналов для дашборда. */
export function MessagesStatsWidget() {
  const stats = useObservable(statsOverview$, null);

  if (!stats) {
    return (
      <Panel title="Сводка сообщений">
        <p className="ds-muted">Загрузка…</p>
      </Panel>
    );
  }

  return (
    <Panel title="Сводка сообщений">
      <div className="ds-stat-grid">
        <StatTile label="Всего raw" value={stats.rawTotal} />
        <StatTile label="Live" value={stats.live} />
        <StatTile label="Backfill" value={stats.backfill} />
        <StatTile label="Manual" value={stats.manual} />
        <StatTile label="События" value={stats.parsedEvents} />
        <StatTile label="Parse ok" value={stats.parseOk} dotColor="var(--status-ok)" />
        <StatTile label="Failed" value={stats.parseFailed} dotColor="var(--status-error)" />
        <StatTile label="Skipped" value={stats.parseSkipped} dotColor="var(--text-muted)" />
        <StatTile label="Каналы" value={`${stats.channelsListening}/${stats.channelsTotal}`} />
        <StatTile label="Providers" value={`${stats.providersActive}/${stats.providersTotal}`} />
      </div>
      <div className="ds-metric-row" style={{ marginTop: 8 }}>
        <span className="ds-metric-row__label">Последнее raw</span>
        <span className="ds-metric-row__value">{formatDateTime(stats.lastRawPostedAt)}</span>
      </div>
    </Panel>
  );
}
