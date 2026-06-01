import { Panel, StatTile } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import { statsOverview$ } from "../../shared/state/adminStore";
import { formatDateTime } from "../format";

function pct(part: number, total: number): string {
  if (total <= 0) return "—";
  return `${Math.round((part / total) * 100)}%`;
}

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

  const events = stats.parsedEvents;

  return (
    <Panel title="Сводка сообщений">
      <div className="ds-stat-grid">
        <StatTile label="Всего raw" value={stats.rawTotal} />
        <StatTile label="Live" value={stats.live} />
        <StatTile label="Backfill" value={stats.backfill} />
        <StatTile label="Manual" value={stats.manual} />
        <StatTile label="События" value={events} />
        <StatTile label="Parse ok" value={stats.parseOk} dotColor="var(--status-ok)" />
        <StatTile label="Failed" value={stats.parseFailed} dotColor="var(--status-error)" />
        <StatTile label="Skipped" value={stats.parseSkipped} dotColor="var(--text-muted)" />
        <StatTile label="Каналы" value={`${stats.channelsListening}/${stats.channelsTotal}`} />
        <StatTile label="Providers" value={`${stats.providersActive}/${stats.providersTotal}`} />
      </div>

      {stats.phaseEnrichment.length > 0 && (
        <>
          <p
            className="ds-muted"
            style={{ fontSize: 10, margin: "10px 0 6px", lineHeight: 1.35 }}
          >
            Обогащение (phase_coverage): <strong>done★</strong> — фаза done и есть parsed_event;
            доля от {events} событий. <strong>done</strong> без ★ — прогон фазы без события (noise).
          </p>
          <div className="admin-phase-enrich-grid">
            {stats.phaseEnrichment.map(({ phaseId, counts }) => (
              <div key={phaseId} className="admin-phase-enrich-card">
                <span className="admin-phase-enrich-card__id">{phaseId}</span>
                <span className="admin-phase-enrich-card__main">
                  done★ {counts.doneForParsed}{" "}
                  <span className="ds-muted">({pct(counts.doneForParsed, events)})</span>
                </span>
                <span className="ds-muted" style={{ fontSize: 10 }}>
                  done {counts.done} · fail {counts.failed} · pend {counts.pending}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="ds-metric-row" style={{ marginTop: 8 }}>
        <span className="ds-metric-row__label">Последнее raw</span>
        <span className="ds-metric-row__value">{formatDateTime(stats.lastRawPostedAt)}</span>
      </div>
    </Panel>
  );
}
