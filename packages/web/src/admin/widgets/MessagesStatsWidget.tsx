import { useState, type ReactNode } from "react";
import type { GeoEnrichmentCounts, PhaseCoverageCounts, StatsOverview } from "@radar/shared";
import { Button, Panel, StatTile } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import { adminApi } from "../../shared/api/adminApi";
import { formatAge } from "../../shared/state/derivations";
import { statsOverview$ } from "../../shared/state/adminStore";
import { reportAppError } from "../../shared/state/appLogStore";
import { formatDateTime } from "../format";

function fmt(n: number): string {
  return n.toLocaleString("ru-RU");
}

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

function pctLabel(part: number, total: number): string {
  if (total <= 0) return "—";
  return `${pct(part, total)}%`;
}

/** Среднее число active-событий на один raw (для подсказки в catalog-метриках). */
function eventsPerRawLabel(events: number, raws: number): string {
  if (raws <= 0) return "—";
  const ratio = events / raws;
  return ratio >= 10 ? `${Math.round(ratio)}` : ratio.toFixed(1);
}

function queueTotal(c: PhaseCoverageCounts | GeoEnrichmentCounts): number {
  return c.pending + c.processing + c.done + c.failed;
}

/** Тонкая полоска прогресса с подписью. */
function MetricBar({
  label,
  value,
  max,
  title,
  tone = "accent",
}: {
  label: string;
  value: number;
  max: number;
  title?: string;
  tone?: "accent" | "ok" | "warn";
}) {
  const width = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const fillVar =
    tone === "ok"
      ? "var(--status-ok)"
      : tone === "warn"
        ? "var(--status-warn)"
        : "var(--accent)";

  return (
    <div className="admin-metric-bar" title={title}>
      <div className="admin-metric-bar__head">
        <span>{label}</span>
        <span>
          {pctLabel(value, max)} · {fmt(value)}/{fmt(max)}
        </span>
      </div>
      <div className="ds-progress ds-progress--thin" role="progressbar" aria-valuenow={width}>
        <div className="ds-progress__fill" style={{ width: `${width}%`, background: fillVar }} />
      </div>
    </div>
  );
}

/** Карточка phase_coverage: очередь + покрытие raw с active-событием. */
function PhaseCoverageCard({
  phaseId,
  counts,
  parsedEvents,
  parsedEventsActiveRaws,
}: {
  phaseId: string;
  counts: PhaseCoverageCounts;
  parsedEvents: number;
  parsedEventsActiveRaws: number;
}) {
  const total = queueTotal(counts);
  const queueClosed = counts.done + counts.failed;
  const noiseDone = Math.max(0, counts.done - counts.doneForParsed);
  const rawsRemaining = Math.max(
    0,
    parsedEventsActiveRaws - counts.doneForParsed - counts.pending - counts.processing,
  );
  const queueActive = counts.pending + counts.processing > 0;
  const eventsPerRaw = eventsPerRawLabel(parsedEvents, parsedEventsActiveRaws);

  return (
    <div className="admin-phase-enrich-card">
      <div className="admin-phase-enrich-card__head">
        <span className="admin-phase-enrich-card__id">{phaseId}</span>
        {queueActive && (
          <span className="admin-phase-enrich-card__badge admin-phase-enrich-card__badge--warn">
            в работе
          </span>
        )}
      </div>

      <MetricBar
        label="очередь закрыта"
        value={queueClosed}
        max={total}
        tone={counts.failed > 0 ? "warn" : "ok"}
        title="(done + fail) / все строки phase_coverage"
      />

      <MetricBar
        label="raw с done★"
        value={counts.doneForParsed}
        max={parsedEventsActiveRaws}
        title="done фазы + active parsed_event — доля raw с событием, не строк parsed_events"
      />

      <div className="admin-phase-enrich-card__stats">
        <span title="Фаза done и raw привязан к active событию">done★ {fmt(counts.doneForParsed)}</span>
        <span title="Все done в phase_coverage (включая noise без события)">done {fmt(counts.done)}</span>
        <span>fail {fmt(counts.failed)}</span>
        <span>pend {fmt(counts.pending)}</span>
        {counts.processing > 0 && <span>proc {fmt(counts.processing)}</span>}
      </div>

      <div className="admin-phase-enrich-card__hint">
        <span title="Строк parsed_events vs distinct raw с событием">
          {fmt(parsedEvents)} событий · {fmt(parsedEventsActiveRaws)} raw · ~{eventsPerRaw} событий/raw
        </span>
        {noiseDone > 0 && (
          <span title="done без active parsed_event — шум / отозванный parse">
            noise {fmt(noiseDone)} ({pctLabel(noiseDone, counts.done)} от done)
          </span>
        )}
        {rawsRemaining > 0 && (
          <span title="Raw с событием ещё без done★ на этой фазе">
            без фазы: ~{fmt(rawsRemaining)} raw
          </span>
        )}
        {!queueActive && rawsRemaining === 0 && counts.failed === 0 && (
          <span style={{ color: "var(--status-ok)" }}>очередь пуста · все raw закрыты</span>
        )}
      </div>
    </div>
  );
}

function GeoPhaseCard({
  phaseId,
  provider,
  enabled,
  counts,
  placesCatalog,
}: {
  phaseId: string;
  provider: string | null;
  enabled: boolean;
  counts: GeoEnrichmentCounts;
  placesCatalog: number;
}) {
  const [resetting, setResetting] = useState(false);
  const jobsTotal = queueTotal(counts);
  const jobsClosed = counts.done + counts.failed;
  const jobsSuccessful = counts.done;
  const queueActive = counts.pending + counts.processing > 0;

  const onResetFailed = async (): Promise<void> => {
    setResetting(true);
    try {
      await adminApi.phasesResetFailed(phaseId);
      statsOverview$.next(await adminApi.statsOverview());
    } catch (error) {
      reportAppError("Geo retry", error);
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="admin-phase-enrich-card" style={{ opacity: enabled ? 1 : 0.55 }}>
      <div className="admin-phase-enrich-card__head">
        <span className="admin-phase-enrich-card__id">{phaseId}</span>
        {enabled && queueActive && (
          <span className="admin-phase-enrich-card__badge admin-phase-enrich-card__badge--warn">▶</span>
        )}
        {!enabled && <span className="ds-muted">выкл</span>}
      </div>

      <MetricBar
        label="каталог enriched★"
        value={counts.doneWithEvidence}
        max={placesCatalog}
        tone="ok"
        title="places с координатами после done (doneWithEvidence / placesCatalog)"
      />

      <MetricBar
        label="jobs завершены (done+failed)"
        value={jobsClosed}
        max={jobsTotal}
        tone={counts.failed > 0 ? "warn" : "accent"}
        title="терминальные jobs: done + failed"
      />

      <MetricBar
        label="успешность jobs (done)"
        value={jobsSuccessful}
        max={Math.max(jobsClosed, 1)}
        tone={counts.failed > 0 ? "warn" : "ok"}
        title="done / (done + failed)"
      />

      <div className="admin-phase-enrich-card__stats">
        <span title="doneWithEvidence">enriched★ {fmt(counts.doneWithEvidence)}</span>
        <span title="catalogRemaining">осталось {fmt(counts.catalogRemaining)}</span>
        <span title="успешные jobs">done {fmt(counts.done)}</span>
        <span title="терминальные miss/error">failed {fmt(counts.failed)}</span>
        <span title="очередь к выполнению">pending {fmt(counts.pending)}</span>
      </div>

      <div className="admin-phase-enrich-card__hint">
        <span title="формула: done + failed + pending + processing">
          {provider ?? "—"} · total={fmt(jobsTotal)} = done {fmt(counts.done)} + failed {fmt(counts.failed)} + pending {fmt(counts.pending)} + processing {fmt(counts.processing)}
        </span>
        {counts.failed > 0 && (
          <Button
            variant="ghost"
            disabled={resetting}
            title="Вернуть failed jobs в pending для повторной попытки"
            onClick={() => void onResetFailed()}
          >
            retry failed ({counts.failed})
          </Button>
        )}
      </div>
    </div>
  );
}

/** Горизонтальная воронка: ingest → parse → enrich. */
function PipelineStrip({ stats }: { stats: StatsOverview }) {
  const catalog = stats.phaseEnrichment.find((p) => p.phaseId === "catalog");
  const catalogStar = catalog?.counts.doneForParsed ?? 0;
  const geoStar = stats.geoEnrichment.reduce((sum, g) => sum + g.counts.doneWithEvidence, 0);

  const steps = [
    { label: "Raw", value: stats.rawTotal, sub: `live ${fmt(stats.live)}` },
    { label: "Parse ok", value: stats.parseOk, sub: `fail ${fmt(stats.parseFailed)}` },
    {
      label: "События",
      value: stats.parsedEvents,
      sub: `${fmt(stats.parsedEventsActiveRaws)} raw`,
    },
    {
      label: "Catalog★",
      value: catalogStar,
      sub: pctLabel(catalogStar, stats.parsedEventsActiveRaws),
    },
    { label: "Geo★", value: geoStar, sub: pctLabel(geoStar, stats.placesCatalogActive) },
  ];

  return (
    <div className="admin-pipeline">
      {steps.map((step, i) => (
        <div key={step.label} className="admin-pipeline__step">
          {i > 0 && <span className="admin-pipeline__arrow" aria-hidden>→</span>}
          <div className="admin-pipeline__body">
            <span className="admin-pipeline__label">{step.label}</span>
            <span className="admin-pipeline__value">{fmt(step.value)}</span>
            <span className="admin-pipeline__sub">{step.sub}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function KpiSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="admin-dashboard-kpi">
      <h3 className="admin-dashboard-kpi__title">{title}</h3>
      <div className="ds-stat-grid">{children}</div>
    </div>
  );
}

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
            <strong>jobs завершены</strong> = (done + failed) / totalJobs, это показатель закрытия очереди, а не качества геокодинга.
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
