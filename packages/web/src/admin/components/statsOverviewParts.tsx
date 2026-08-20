import { useState } from "react";
import type { GeoEnrichmentCounts, PhaseCoverageCounts, StatsOverview } from "@radar/shared";
import { Button } from "../../shared/ds";
import { adminApi } from "../../shared/api/adminApi";
import { statsOverview$ } from "../../shared/state/adminStore";
import { reportAppError } from "../../shared/state/appLogStore";

export function fmt(n: number): string {
  return n.toLocaleString("ru-RU");
}

export function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

export function pctLabel(part: number, total: number): string {
  if (total <= 0) return "—";
  return `${pct(part, total)}%`;
}

/** Среднее число active-событий на один raw (для подсказки в catalog-метриках). */
export function eventsPerRawLabel(events: number, raws: number): string {
  if (raws <= 0) return "—";
  const ratio = events / raws;
  return ratio >= 10 ? `${Math.round(ratio)}` : ratio.toFixed(1);
}

export function queueTotal(c: PhaseCoverageCounts | GeoEnrichmentCounts): number {
  return c.pending + c.processing + c.done + c.failed;
}

/** Тонкая полоска прогресса с подписью. */
export function MetricBar({
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
export function PhaseCoverageCard({
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

export function GeoPhaseCard({
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
          {provider ?? "—"} · total={fmt(jobsTotal)} = done {fmt(counts.done)} + failed{" "}
          {fmt(counts.failed)} + pending {fmt(counts.pending)} + processing {fmt(counts.processing)}
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
export function PipelineStrip({ stats }: { stats: StatsOverview }) {
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
