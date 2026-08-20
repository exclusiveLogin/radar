import { Panel } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import { statsOverview$ } from "../../shared/state/adminStore";
import { GeoPhaseCard } from "../components/statsOverviewParts";

/** Карточки geo · place_enrichment_jobs. */
export function OverviewGeoEnrichmentWidget() {
  const stats = useObservable(statsOverview$, null);

  if (!stats) {
    return (
      <Panel title="Geo · place_enrichment_jobs">
        <p className="ds-muted">Загрузка…</p>
      </Panel>
    );
  }

  if (stats.geoEnrichment.length === 0) {
    return (
      <Panel title="Geo · place_enrichment_jobs">
        <p className="ds-muted">Нет данных по geo-фазам.</p>
      </Panel>
    );
  }

  return (
    <Panel title="Geo · place_enrichment_jobs">
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
    </Panel>
  );
}
