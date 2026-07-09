import { Panel, StatTile } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import { formatAge } from "../../shared/state/derivations";
import { statsOverview$ } from "../../shared/state/adminStore";
import { formatDateTime } from "../format";
import {
  eventsPerRawLabel,
  fmt,
  GeoPhaseCard,
  KpiSection,
  pctLabel,
  PhaseCoverageCard,
  PipelineStrip,
} from "../components/statsOverviewParts";

/** Глобальные счётчики системы для верхней панели админки. */
export function MessagesStatsWidget() {
  const stats = useObservable(statsOverview$, null);

  if (!stats) {
    return (
      <Panel title="Сводка системы">
        <p className="ds-muted">Загрузка…</p>
      </Panel>
    );
  }

  const bf = stats.backfillJobs;
  const bfActive = bf.pending + bf.running;
  const catalog = stats.phaseEnrichment.find((p) => p.phaseId === "catalog");
  const catalogRawPct = pctLabel(catalog?.counts.doneForParsed ?? 0, stats.parsedEventsActiveRaws);
  const eventsPerRaw = eventsPerRawLabel(stats.parsedEvents, stats.parsedEventsActiveRaws);

  return (
    <Panel title="Сводка системы">
      <PipelineStrip stats={stats} />

      <div className="admin-dashboard-kpi-row">
        <KpiSection title="Ingest">
          <StatTile label="Всего raw" value={fmt(stats.rawTotal)} />
          <StatTile label="Live" value={fmt(stats.live)} dotColor="var(--status-ok)" />
          <StatTile label="Backfill" value={fmt(stats.backfill)} />
          <StatTile label="Manual" value={fmt(stats.manual)} />
        </KpiSection>

        <KpiSection title="Parse">
          <StatTile label="Ok" value={fmt(stats.parseOk)} dotColor="var(--status-ok)" />
          <StatTile label="Failed" value={fmt(stats.parseFailed)} dotColor="var(--status-error)" />
          <StatTile label="Skipped" value={fmt(stats.parseSkipped)} />
          <StatTile label="События" value={fmt(stats.parsedEvents)} />
        </KpiSection>

        <KpiSection title="Инфра">
          <StatTile label="Каналы" value={`${stats.channelsListening}/${stats.channelsTotal}`} />
          <StatTile label="Providers" value={`${stats.providersActive}/${stats.providersTotal}`} />
          <StatTile
            label="BF jobs"
            value={bfActive > 0 ? `${bfActive} акт.` : "—"}
            dotColor={bfActive > 0 ? "var(--status-warn)" : undefined}
          />
          <StatTile label="Places" value={fmt(stats.placesCatalogActive)} />
        </KpiSection>
      </div>

      {stats.phaseEnrichment.length > 0 && (
        <section className="admin-dashboard-block">
          <h3 className="admin-dashboard-block__title">Обогащение · phase_coverage</h3>
          <p className="admin-dashboard-block__lead">
            <strong>done★</strong> — фаза done и raw привязан к active parsed_event.{" "}
            Процент у catalog — доля от <em>raw с событием</em> ({catalogRawPct}), не от строк
            parsed_events: один raw может породить несколько событий (
            {fmt(stats.parsedEvents)} событий · {fmt(stats.parsedEventsActiveRaws)} raw · ~
            {eventsPerRaw} событий/raw). При pend=0 очередь закрыта, но часть raw ещё без done★
            или прошла как noise.
          </p>
          <div className="admin-phase-enrich-grid admin-phase-enrich-grid--wide">
            {stats.phaseEnrichment.map(({ phaseId, counts }) => (
              <PhaseCoverageCard
                key={phaseId}
                phaseId={phaseId}
                counts={counts}
                parsedEvents={stats.parsedEvents}
                parsedEventsActiveRaws={stats.parsedEventsActiveRaws}
              />
            ))}
          </div>
        </section>
      )}

      {stats.geoEnrichment.length > 0 && (
        <section className="admin-dashboard-block">
          <h3 className="admin-dashboard-block__title">Geo · place_enrichment_jobs</h3>
          <p className="admin-dashboard-block__lead">
            <strong>enriched★</strong> = doneWithEvidence / placesCatalog.{" "}
            <strong>jobs завершены</strong> = (done + failed) / totalJobs, это показатель закрытия
            очереди, а не качества геокодинга.
          </p>
          <div className="admin-phase-enrich-grid admin-phase-enrich-grid--wide">
            {stats.geoEnrichment.map(({ phaseId, provider, enabled, counts }) => (
              <GeoPhaseCard
                key={phaseId}
                phaseId={phaseId}
                provider={provider}
                enabled={enabled}
                counts={counts}
                placesCatalog={stats.placesCatalogActive}
              />
            ))}
          </div>
        </section>
      )}

      <div className="admin-dashboard-footer">
        <span className="ds-metric-row__label">Последнее raw</span>
        <span className="ds-metric-row__value" title={formatDateTime(stats.lastRawPostedAt)}>
          {stats.lastRawPostedAt ? formatAge(stats.lastRawPostedAt) : "—"}
        </span>
      </div>
    </Panel>
  );
}
