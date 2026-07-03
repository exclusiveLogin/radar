import { useEffect, useState } from "react";
import { NEXTGEN_RECOMMENDED_BATCH_SIZE } from "@radar/shared";
import { Button, Field, Panel } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import { adminApi } from "../../shared/api/adminApi";
import { refreshTrackingStatus, trackingStatus$ } from "../../shared/state/adminStore";
import { reportAppError } from "../../shared/state/appLogStore";

/** Master-контроль пайплайна треков: ВКЛ/ВЫКЛ, pause/resume, rebuild, reset. */
type PendingAction = "enabled" | "config" | "pause" | "resume" | "rebuild" | "soft" | "reset";

const CLIENT_TIMEOUT_MS = 90_000;

function withClientTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

export function TrackingPipelineWidget() {
  const status = useObservable(trackingStatus$, null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [batchSize, setBatchSize] = useState("500");

  useEffect(() => {
    const v = status?.config?.batchSize;
    if (v != null) setBatchSize(String(v));
  }, [status?.config?.batchSize]);

  const activeRun = status?.activeRun;

  const run = async (kind: PendingAction, action: () => Promise<unknown>) => {
    setPending(kind);
    try {
      await withClientTimeout(
        action(),
        CLIENT_TIMEOUT_MS,
        "Операция заняла слишком много времени. Проверьте логи API и обновите статус.",
      );
      await refreshTrackingStatus();
    } catch (e) {
      reportAppError("Треки", e);
    } finally {
      setPending(null);
    }
  };

  const controlsLocked = pending !== null;

  const m = status?.metrics;
  /** Прогресс пайплайна: обработано / целевые (не = ноды в треках). */
  const pipelineProcessed = m?.processedCandidates ?? 0;
  const total = m?.totalTargetCandidates ?? 0;
  const percent = m?.percentPipelineProcessed ?? m?.percentProcessed ?? 0;
  const nodesCoverage = m?.percentNodesInTracks ?? 0;

  const fmtMs = (ms?: number) => {
    if (ms == null) return "—";
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}ч ${m % 60}м`;
    if (m > 0) return `${m}м ${s % 60}с`;
    return `${s}с`;
  };

  const canPause =
    status?.enabled === true
    && status.activeRun?.status !== "paused"
    && !status.paused;
  const canResume =
    status?.enabled === true
    && (status.paused || status.activeRun?.status === "paused");

  const ps = status?.pipelineStatus;
  const statusColor =
    ps?.code === "running" ? "var(--accent)"
    : ps?.code === "failed" ? "var(--danger)"
    : ps?.code === "paused" ? "var(--warning, #c9a227)"
    : ps?.code === "waiting" ? "var(--accent)"
    : "var(--text-muted)";

  return (
    <Panel title="Пайплайн треков" className="tracking-pipeline-widget">
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
          <Metric label="Материализаций" value={m.nodesInTracks.toLocaleString()} />
          <Metric label="% покрытия нодами" value={`${m.percentNodesInTracks}%`} />
          <Metric label="В очереди" value={(m.unconsumedPipeline ?? 0).toLocaleString()} />
          <Metric label="% пайплайна" value={`${m.percentPipelineProcessed ?? m.percentProcessed}%`} />
          <Metric label="Треки активные" value={m.tracksActive.toLocaleString()} />
          <Metric label="Треки закрыты" value={m.tracksClosed.toLocaleString()} />
          <Metric label="Треки stale" value={m.tracksStale.toLocaleString()} />
          {m.softAssigns != null && (
            <Metric label="Soft assigns" value={m.softAssigns.toLocaleString()} />
          )}
          {m.attentionConflicts != null && (
            <Metric label="Attention conflicts" value={m.attentionConflicts.toLocaleString()} />
          )}
          <Metric label="Время run" value={fmtMs(m.elapsedMs)} />
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Button
          variant={status?.enabled ? "primary" : "ghost"}
          disabled={pending === "enabled"}
          onClick={() => void run("enabled", () => adminApi.trackingPatchEnabled(!status?.enabled))}
        >
          {status?.enabled ? "Выключить" : "Включить"}
        </Button>
        <span>
          {pipelineProcessed.toLocaleString()} / {total.toLocaleString()} ({percent.toFixed(1)}%)
        </span>
        <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
          ноды: {nodesCoverage}%
        </span>
      </div>
      {pending && (
        <p style={{ marginTop: 8, fontSize: 11, color: "var(--accent)" }}>
          Выполняется: {pending}…
        </p>
      )}
      {ps && (
        <div style={{ marginTop: 8, fontSize: 12 }}>
          <span style={{ fontWeight: 600, color: statusColor }}>{ps.label}</span>
          <p style={{ margin: "4px 0 0", color: "var(--text-muted)", lineHeight: 1.4 }}>
            {ps.detail}
          </p>
          {ps.remainingCandidates != null && ps.remainingCandidates > 0 && (
            <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-muted)" }}>
              В очереди: {ps.remainingCandidates.toLocaleString("ru-RU")}
            </p>
          )}
        </div>
      )}
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
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "flex-end",
          marginTop: 10,
        }}
      >
        <Field label="Тик (точек за проход)">
          <input
            className="ds-input"
            type="number"
            min={10}
            max={20000}
            step={10}
            value={batchSize}
            onChange={e => setBatchSize(e.target.value)}
            style={{ width: 100 }}
            title="Сколько pending assign за проход daemon. ST-DBSCAN closure — вся очередь + якоря."
          />
        </Field>
        <Button
          variant="ghost"
          disabled={controlsLocked}
          onClick={() =>
            void run("config", async () => {
              const n = Number(batchSize);
              if (!Number.isFinite(n) || n < 10 || n > 20000) {
                throw new Error("batchSize: 10–20000");
              }
              await adminApi.trackingPatchConfig({ batchSize: n });
            })
          }
        >
          Применить тик
        </Button>
        {status && (
          <div className="tracking-pipeline-widget__meta" style={{ fontSize: 11, color: "var(--text-muted)", paddingBottom: 6 }}>
            <span>
              Тик: {status.config?.batchSize ?? 500}
              {status.metrics?.effectiveBatchSize != null
                && status.metrics.effectiveBatchSize !== (status.config?.batchSize ?? 500)
                ? ` (факт ${status.metrics.effectiveBatchSize})`
                : ""}
              {" · "}очередь{" "}
              {status.metrics?.unconsumedPipeline?.toLocaleString("ru-RU") ?? "—"}
              {" · "}closure{" "}
              {status.metrics?.dedupClosureSize?.toLocaleString("ru-RU") ?? "—"}
              {activeRun?.stats?.stage && activeRun.stats.stage !== "idle" && (
                <> · стадия: {activeRun.stats.stage}</>
              )}
              {" · "}разбивка по фазам — в блоке «Прогресс по фазам» ниже
            </span>
          </div>
        )}
      </div>
      {Number(batchSize) > NEXTGEN_RECOMMENDED_BATCH_SIZE && (
        <p style={{ fontSize: 11, color: "var(--warning, #c9a227)", marginTop: 6 }}>
          ⚠️ Выше рекомендованных {NEXTGEN_RECOMMENDED_BATCH_SIZE}: фазы Cluster/Join (кластеризация +
          Kalman-join) — O(n²) по кандидатам и Kalman × открытые треки, время/стоимость тика на большем
          объёме не валидированы. Настройка применяется как есть — сначала проверьте на тесте.
        </p>
      )}
      {status?.watermark && (
        <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
          Watermark: {status.watermark.lastOccurredAt}
        </p>
      )}
      {status?.activeRun?.error && (
        <p style={{ fontSize: 11, color: "var(--danger)", marginTop: 6 }}>
          Ошибка run: {status.activeRun.error}
        </p>
      )}
      {!status?.activeRun?.error && status?.lastRun?.status === "failed" && status.lastRun.error && (
        <p style={{ fontSize: 11, color: "var(--danger)", marginTop: 6 }}>
          Ошибка run: {status.lastRun.error}
        </p>
      )}
      <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
        <Button variant="ghost" disabled={controlsLocked || !canPause} onClick={() => void run("pause", () => adminApi.trackingPause())}>
          Pause
        </Button>
        <Button variant="ghost" disabled={controlsLocked || !canResume} onClick={() => void run("resume", () => adminApi.trackingResume())}>
          Resume
        </Button>
        <Button
          variant="ghost"
          disabled={controlsLocked}
          onClick={() => {
            if (!window.confirm("Full rebuild: truncate + catch-up?")) return;
            void run("rebuild", () => adminApi.trackingRebuild());
          }}
        >
          Rebuild
        </Button>
        <Button
          variant="ghost"
          disabled={controlsLocked}
          onClick={() => {
            if (
              !window.confirm(
                "Soft rebuild: удалить треки и заново прогнать те же точки с текущим config (веса не сбрасываются)?",
              )
            ) {
              return;
            }
            void run("soft", () => adminApi.trackingSoftRebuild());
          }}
        >
          Soft rebuild
        </Button>
        <Button
          variant="danger"
          disabled={controlsLocked}
          onClick={() => {
            if (!window.confirm("Reset watermark и truncate треков?")) return;
            void run("reset", () => adminApi.trackingReset());
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
