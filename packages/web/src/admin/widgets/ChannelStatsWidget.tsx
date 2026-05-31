import { Panel, StatTile } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import { selectedChannelStats$ } from "../../shared/state/adminStore";
import { selectedChannelKey$ } from "../../shared/state/channelSelectionStore";
import { formatDateTime } from "../format";

/** Статистика сообщений/парсинга выбранного канала. */
export function ChannelStatsWidget() {
  const selected = useObservable(selectedChannelKey$, null);
  const stats = useObservable(selectedChannelStats$, null);

  if (!selected) {
    return (
      <Panel title="Статистика канала">
        <p className="ds-muted">Выберите канал, чтобы увидеть статистику.</p>
      </Panel>
    );
  }

  if (!stats) {
    return (
      <Panel title="Статистика канала">
        <p className="ds-muted">Загрузка…</p>
      </Panel>
    );
  }

  return (
    <Panel title={`Статистика: ${selected}`}>
      <div className="ds-stat-grid">
        <StatTile label="Всего raw" value={stats.rawTotal} />
        <StatTile label="Live" value={stats.live} />
        <StatTile label="Backfill" value={stats.backfill} />
        <StatTile label="Manual" value={stats.manual} />
        <StatTile label="Parse ok" value={stats.parsedOk} dotColor="var(--status-ok)" />
        <StatTile label="Failed" value={stats.parseFailed} dotColor="var(--status-error)" />
        <StatTile label="Skipped" value={stats.parseSkipped} dotColor="var(--text-muted)" />
      </div>
      <div className="ds-metric-row" style={{ marginTop: 8 }}>
        <span className="ds-metric-row__label">Последнее сообщение</span>
        <span className="ds-metric-row__value">{formatDateTime(stats.lastPostedAt)}</span>
      </div>
    </Panel>
  );
}
