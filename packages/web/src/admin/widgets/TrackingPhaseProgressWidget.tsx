import type { TrackingPhaseId, TrackingRebuildStats } from "@radar/shared";
import { Panel } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import { trackingStatus$ } from "../../shared/state/adminStore";

/** Русские подписи фаз NextGen pipeline — презентационная деталь, не часть домена. */
const PHASE_LABELS: Record<TrackingPhaseId, string> = {
  cluster: "1. Cluster",
  filter: "2. Filter",
  field_train: "3. Field train",
  join: "4. Join",
  optimize: "5. Optimize",
};

const PHASE_HINTS: Record<TrackingPhaseId, string> = {
  cluster: "ST-DBSCAN дедуп кандидатов → узлы",
  filter: "Pair-reliability фильтр сверх Ф2 (заготовка)",
  field_train: "Обучение H3 векторного поля на парах узлов",
  join: "Kalman-локус + H3-гравитация → треки",
  optimize: "Post-join cleanup/refine (заготовка)",
};

function fmt(n: number | undefined): string {
  return (n ?? 0).toLocaleString("ru-RU");
}

function fmtPct(n: number | undefined): string {
  return n == null ? "—" : `${(n * 100).toFixed(1)}%`;
}

function PhaseCard({
  id,
  enabled,
  active,
  rows,
}: {
  id: TrackingPhaseId;
  enabled: boolean;
  active: boolean;
  rows: [string, string][];
}) {
  return (
    <div
      style={{
        border: `1px solid ${active ? "var(--accent)" : "var(--surface-2)"}`,
        borderRadius: 6,
        padding: "8px 10px",
        opacity: enabled ? 1 : 0.55,
        background: active ? "var(--surface-2)" : "transparent",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontWeight: 600, fontSize: 12 }}>{PHASE_LABELS[id]}</span>
        <span style={{ fontSize: 10, color: active ? "var(--accent)" : "var(--text-muted)" }}>
          {enabled ? (active ? "running" : "idle") : "отключена"}
        </span>
      </div>
      <p style={{ margin: "3px 0 6px", fontSize: 10, color: "var(--text-muted)" }}>
        {PHASE_HINTS[id]}
      </p>
      {enabled && rows.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 14, fontSize: 11, lineHeight: 1.6 }}>
          {rows.map(([label, value]) => (
            <li key={label}>
              {label}: {value}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function phaseRows(id: TrackingPhaseId, phaseStats: TrackingRebuildStats["phaseStats"]): [string, string][] {
  const cluster = phaseStats?.cluster;
  const fieldTrain = phaseStats?.field_train;
  const join = phaseStats?.join;
  switch (id) {
    case "cluster":
      return cluster
        ? [
            ["Кандидатов", fmt(cluster.candidatesIn)],
            ["Узлов сформировано", fmt(cluster.nodesOut)],
          ]
        : [];
    case "field_train":
      return fieldTrain
        ? [
            ["Пар принято", `${fmt(fieldTrain.pairsAccepted)} / ${fmt(fieldTrain.pairsConsidered)}`],
            ["Reject кинематикой", fmt(fieldTrain.pairsRejectedByKinematics)],
            ["Достоверность avg/p95", `${fmtPct(fieldTrain.reliabilityAvg)} / ${fmtPct(fieldTrain.reliabilityP95)}`],
          ]
        : [];
    case "join":
      return join
        ? [
            ["Линков принято", `${fmt(join.linksAccepted)} / ${fmt(join.linksConsidered)}`],
            ["Засеяно новых", fmt(join.nodesSeeded)],
            ["Треки открыт/закрыт", `${fmt(join.tracksOpen)} / ${fmt(join.tracksClosed)}`],
            ["Нод добавлено", fmt(join.nodesAdded)],
            [
              "Reject gap/dist/vel",
              `${fmt(join.rejectGap)} / ${fmt(join.rejectDistance)} / ${fmt(join.rejectVelocity)}`,
            ],
            ["Reject противоток/поворот", `${fmt(join.rejectCounterFlow)} / ${fmt(join.rejectTurn)}`],
            ["Reject Kalman innovation", fmt(join.rejectKalmanInnovation)],
          ]
        : [];
    case "filter":
    case "optimize":
      return [];
  }
}

/** Прогресс NextGen pipeline, разбитый по 5 фазам phase-constructor'а (SSOT: phaseManifest). */
export function TrackingPhaseProgressWidget() {
  const status = useObservable(trackingStatus$, null);
  const stats = status?.activeRun?.stats ?? status?.lastRun?.stats;
  const runStatus = status?.activeRun?.status ?? status?.lastRun?.status ?? "idle";
  const m = status?.metrics;
  const manifest = status?.phaseManifest ?? [];

  const tickSize = m?.effectiveBatchSize ?? status?.config?.batchSize ?? stats?.batchSize ?? 500;
  const processed = stats?.processedCandidates ?? m?.processedCandidates ?? 0;
  const total = stats?.totalCandidates ?? m?.totalTargetCandidates ?? 0;
  const tickPercent = stats?.percentApprox ?? m?.percentPipelineProcessed ?? 0;
  const activePhaseId = runStatus === "running" ? stats?.stage : undefined;

  return (
    <Panel title="Прогресс по фазам">
      <div style={{ fontSize: 12, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span>
            Run: {processed.toLocaleString("ru-RU")} / {total.toLocaleString("ru-RU")} ({tickPercent}%)
          </span>
          <span style={{ color: "var(--text-muted)" }}>тик ≤ {tickSize}</span>
        </div>
        <div style={{ marginTop: 6, height: 6, background: "var(--surface-2)", borderRadius: 3, overflow: "hidden" }}>
          <div style={{ width: `${tickPercent}%`, height: "100%", background: "var(--accent)" }} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
        {manifest.map(entry => (
          <PhaseCard
            key={entry.id}
            id={entry.id}
            enabled={entry.enabled}
            active={entry.enabled && activePhaseId === entry.id}
            rows={phaseRows(entry.id, stats?.phaseStats)}
          />
        ))}
      </div>
    </Panel>
  );
}
