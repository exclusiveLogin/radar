import { Panel } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import { trackingStatus$ } from "../../shared/state/adminStore";

function ScannerCard({
  title,
  stage,
  lines,
}: {
  title: string;
  stage: string;
  lines: string[];
}) {
  return (
    <Panel title={title}>
      <p style={{ fontSize: 11, color: "var(--text-muted)" }}>Статус: {stage}</p>
      <ul style={{ margin: "8px 0 0", paddingLeft: 16, fontSize: 12 }}>
        {lines.map(line => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </Panel>
  );
}

/** Карточки ST-DBSCAN и Kalman с прогрессом текущего батча. */
export function TrackingScannersWidget() {
  const status = useObservable(trackingStatus$, null);
  const stats = status?.activeRun?.stats;
  const cfg = status?.config;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <ScannerCard
        title="ST-DBSCAN"
        stage={stats?.stage === "stdbscan" ? "running" : "idle"}
        lines={[
          `Батч: ${stats?.batchSize ?? cfg?.batchSize ?? 1000}`,
          `Кластеров: ${stats?.stdbscanClusters ?? 0}`,
          `Схлопнуто: ${stats?.stdbscanCollapsed ?? 0}`,
        ]}
      />
      <ScannerCard
        title="Kalman Builder"
        stage={stats?.stage === "kalman" || stats?.stage === "persisting" ? "running" : "idle"}
        lines={[
          `Open tracks: ${stats?.kalmanTracksOpen ?? 0}`,
          `Closed в батче: ${stats?.kalmanTracksClosed ?? 0}`,
          `Нод добавлено: ${stats?.kalmanNodesAdded ?? 0}`,
        ]}
      />
    </div>
  );
}
