import { Panel } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import { formatAge } from "../../shared/state/derivations";
import { statsOverview$ } from "../../shared/state/adminStore";
import { formatDateTime } from "../format";
import { PipelineStrip } from "../components/statsOverviewParts";

/** Воронка Raw → Parse → События → Catalog★ → Geo★ + возраст последнего raw. */
export function OverviewPipelineWidget() {
  const stats = useObservable(statsOverview$, null);

  if (!stats) {
    return (
      <Panel title="Воронка">
        <p className="ds-muted">Загрузка…</p>
      </Panel>
    );
  }

  const lastRawLabel = stats.lastRawPostedAt
    ? formatAge(stats.lastRawPostedAt)
    : "—";

  return (
    <Panel
      title="Воронка"
      actions={
        <span
          className="ds-muted"
          style={{ fontSize: 12 }}
          title={formatDateTime(stats.lastRawPostedAt)}
        >
          Последнее raw · {lastRawLabel}
        </span>
      }
    >
      <PipelineStrip stats={stats} />
    </Panel>
  );
}
