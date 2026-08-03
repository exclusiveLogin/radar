import { Panel } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import { statsOverview$ } from "../../shared/state/adminStore";
import {
  eventsPerRawLabel,
  fmt,
  pctLabel,
  PhaseCoverageCard,
} from "../components/statsOverviewParts";

/** Карточки phase_coverage по фазам обогащения. */
export function OverviewPhaseCoverageWidget() {
  const stats = useObservable(statsOverview$, null);

  if (!stats) {
    return (
      <Panel title="Обогащение · phase_coverage">
        <p className="ds-muted">Загрузка…</p>
      </Panel>
    );
  }

  if (stats.phaseEnrichment.length === 0) {
    return (
      <Panel title="Обогащение · phase_coverage">
        <p className="ds-muted">Нет данных по фазам.</p>
      </Panel>
    );
  }

  const catalog = stats.phaseEnrichment.find((p) => p.phaseId === "catalog");
  const catalogRawPct = pctLabel(
    catalog?.counts.doneForParsed ?? 0,
    stats.parsedEventsActiveRaws,
  );
  const eventsPerRaw = eventsPerRawLabel(
    stats.parsedEvents,
    stats.parsedEventsActiveRaws,
  );

  return (
    <Panel title="Обогащение · phase_coverage">
      <p className="admin-dashboard-block__lead">
        <strong>done★</strong> — фаза done и raw привязан к active parsed_event. Процент у
        catalog — доля от <em>raw с событием</em> ({catalogRawPct}), не от строк parsed_events:
        один raw может породить несколько событий ({fmt(stats.parsedEvents)} событий ·{" "}
        {fmt(stats.parsedEventsActiveRaws)} raw · ~{eventsPerRaw} событий/raw). При pend=0
        очередь закрыта, но часть raw ещё без done★ или прошла как noise.
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
    </Panel>
  );
}
