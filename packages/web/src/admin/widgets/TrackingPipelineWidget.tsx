import { useState } from "react";
import { Button, Panel } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import { adminApi } from "../../shared/api/adminApi";
import { refreshTrackingStatus, trackingStatus$ } from "../../shared/state/adminStore";
import { reportAppError } from "../../shared/state/appLogStore";

/** Master-контроль пайплайна треков: ВКЛ/ВЫКЛ, pause/resume, rebuild, reset. */
export function TrackingPipelineWidget() {
  const status = useObservable(trackingStatus$, null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await refreshTrackingStatus();
    } catch (e) {
      reportAppError("Треки", e);
    } finally {
      setBusy(false);
    }
  };

  const percent = status?.percentApprox ?? 0;
  const processed = status?.activeRun?.stats?.processedCandidates ?? status?.metrics?.processedCandidates ?? 0;
  const total = status?.totalCandidates ?? 0;
  const m = status?.metrics;

  const fmtMs = (ms?: number) => {
    if (ms == null) return "—";
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}ч ${m % 60}м`;
    if (m > 0) return `${m}м ${s % 60}с`;
    return `${s}с`;
  };

  return (
    <Panel title="Пайплайн треков">
      {m && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            gap: 8,
            marginBottom: 10,
            fontSize: 12,
          }}
        >
          <Metric label="Целевые точки" value={m.totalTargetCandidates.toLocaleString()} />
          <Metric label="Все гео-точки" value={m.totalCandidatesGeo.toLocaleString()} />
          <Metric label="Обработано" value={m.processedCandidates.toLocaleString()} />
          <Metric label="% обработки" value={`${m.percentProcessed}%`} />
          <Metric label="В треках (узлы)" value={m.nodesInTracks.toLocaleString()} />
          <Metric label="% в треках" value={`${m.percentNodesInTracks}%`} />
          <Metric label="Треки активные" value={m.tracksActive.toLocaleString()} />
          <Metric label="Треки закрыты" value={m.tracksClosed.toLocaleString()} />
          <Metric label="Треки stale" value={m.tracksStale.toLocaleString()} />
          <Metric label="Время run" value={fmtMs(m.elapsedMs)} />
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Button
          variant={status?.enabled ? "primary" : "ghost"}
          disabled={busy}
          onClick={() => void run(() => adminApi.trackingPatchEnabled(!status?.enabled))}
        >
          {status?.enabled ? "ВКЛ" : "ВЫКЛ"}
        </Button>
        <span>
          {processed.toLocaleString()} / {total.toLocaleString()} ({percent.toFixed(1)}%)
        </span>
        <span style={{ color: "var(--text-muted)" }}>
          {status?.activeRun?.status ?? "idle"}
        </span>
      </div>
      <div
        style={{
          marginTop: 8,
          height: 8,
          background: "var(--surface-2)",
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        <div style={{ width: `${percent}%`, height: "100%", background: "var(--accent)" }} />
      </div>
      {status?.watermark && (
        <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
          Watermark: {status.watermark.lastOccurredAt}
        </p>
      )}
      {status?.activeRun?.error && (
        <p style={{ fontSize: 11, color: "var(--danger)", marginTop: 6 }}>
          Ошибка: {status.activeRun.error}
        </p>
      )}
      <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
        <Button variant="ghost" disabled={busy} onClick={() => void run(() => adminApi.trackingPause())}>
          Pause
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => void run(() => adminApi.trackingResume())}>
          Resume
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            if (!window.confirm("Full rebuild: truncate + catch-up?")) return;
            void run(() => adminApi.trackingRebuild());
          }}
        >
          Rebuild
        </Button>
        <Button
          variant="danger"
          disabled={busy}
          onClick={() => {
            if (!window.confirm("Reset watermark и truncate треков?")) return;
            void run(() => adminApi.trackingReset());
          }}
        >
          Reset
        </Button>
      </div>
    </Panel>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: "6px 8px", background: "var(--surface-2)", borderRadius: 4 }}>
      <div style={{ color: "var(--text-muted)", fontSize: 10 }}>{label}</div>
      <div style={{ fontWeight: 600, marginTop: 2 }}>{value}</div>
    </div>
  );
}
