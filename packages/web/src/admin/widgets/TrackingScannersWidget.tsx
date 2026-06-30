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



/** Карточки ST-DBSCAN и Kalman с прогрессом текущего тика. */

export function TrackingScannersWidget() {

  const status = useObservable(trackingStatus$, null);

  const stats = status?.activeRun?.stats ?? status?.lastRun?.stats;

  const runStatus = status?.activeRun?.status ?? status?.lastRun?.status ?? "idle";

  const m = status?.metrics;



  const stageLabel = (() => {

    if (!stats?.stage) return runStatus === "running" ? "ожидание тика" : "idle";

    if (stats.stage === "done") return runStatus === "running" ? "между тиками" : "done";
    if (stats.stage === "idle") return runStatus === "running" ? "между тиками" : "idle";

    return stats.stage;

  })();



  const isStdbscanActive = stats?.stage === "stdbscan";

  const isKalmanActive =

    stats?.stage === "kalman" || stats?.stage === "persisting" || stats?.stage === "loading";



  const tickSize = m?.effectiveBatchSize ?? status?.config?.batchSize ?? stats?.batchSize ?? 500;

  const processed = stats?.processedCandidates ?? m?.processedCandidates ?? 0;

  const total = stats?.totalCandidates ?? m?.totalTargetCandidates ?? 0;

  const tickPercent = stats?.percentApprox ?? m?.percentPipelineProcessed ?? 0;



  return (

    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

      <div style={{ fontSize: 12 }}>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>

          <span>

            Run: {processed.toLocaleString("ru-RU")} / {total.toLocaleString("ru-RU")} (

            {tickPercent}%)

          </span>

          <span style={{ color: "var(--text-muted)" }}>тик ≤ {tickSize}</span>

        </div>

        <div

          style={{

            marginTop: 6,

            height: 6,

            background: "var(--surface-2)",

            borderRadius: 3,

            overflow: "hidden",

          }}

        >

          <div style={{ width: `${tickPercent}%`, height: "100%", background: "var(--accent)" }} />

        </div>

      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>

        <ScannerCard

          title="ST-DBSCAN"

          stage={isStdbscanActive ? "running" : stageLabel}

          lines={[

            `Очередь: ${m?.unconsumedPipeline?.toLocaleString("ru-RU") ?? stats?.pendingCandidates?.toLocaleString("ru-RU") ?? "—"}`,

            `Closure: ${m?.dedupClosureSize?.toLocaleString("ru-RU") ?? stats?.dedupClosureSize?.toLocaleString("ru-RU") ?? "—"}`,

            `Кластеров: ${stats?.stdbscanClusters ?? 0}`,

            `Схлопнуто: ${stats?.stdbscanCollapsed ?? 0}`,

          ]}

        />

        <ScannerCard

          title="Kalman Builder"

          stage={isKalmanActive ? "running" : stageLabel}

          lines={[

            `Open tracks: ${stats?.kalmanTracksOpen ?? 0}`,

            `Closed в тике: ${stats?.kalmanTracksClosed ?? 0}`,

            `Нод добавлено: ${stats?.kalmanNodesAdded ?? 0}`,

          ]}

        />

      </div>

    </div>

  );

}


