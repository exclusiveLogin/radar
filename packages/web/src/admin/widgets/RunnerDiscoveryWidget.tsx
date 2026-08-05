import { useState } from "react";
import type { PipelineKey } from "@radar/shared";
import { Button, Panel, StatusDot } from "../../shared/ds";
import { adminApi } from "../../shared/api/adminApi";
import { useObservable } from "../../shared/hooks/useObservable";
import {
  parsePipelineStatus$,
  phaseRuns$,
  phasesOverview$,
  refreshRunnerDiscovery,
  runnerDiscovery$,
  trackingStatus$,
} from "../../shared/state/adminStore";
import { reportAppError } from "../../shared/state/appLogStore";
import { RuntimeBadge } from "../components/RuntimeBadge";
import { formatDateTime } from "../format";
import {
  buildHostMonitorRows,
  buildRunnerMonitor,
  findActivePhaseRun,
  type HostLiveness,
  type PipelineMonitorSnapshot,
  type RunnerActivity,
} from "../runnerMonitorModel";
import { PhaseRunProgressBar } from "./PhaseRunProgressBar";
import { fmt } from "../components/statsOverviewParts";

const PIPELINE_LABELS: Record<PipelineKey, string> = {
  tracking: "Треки",
  parse: "Парсинг",
  "geo-enrich": "Гео",
};

const ACTIVITY_LABEL: Record<RunnerActivity, string> = {
  offline: "offline",
  rebuild: "rebuild",
  running: "running",
  draining: "draining",
  paused: "paused",
  idle: "idle",
};

const ACTIVITY_KIND: Record<RunnerActivity, "ok" | "warn" | "error" | "neutral"> = {
  offline: "error",
  rebuild: "warn",
  running: "ok",
  draining: "warn",
  paused: "warn",
  idle: "neutral",
};

const LIVENESS_KIND: Record<HostLiveness, "ok" | "warn" | "error" | "neutral"> = {
  alive: "ok",
  stale: "warn",
  missing: "error",
};

const LIVENESS_LABEL: Record<HostLiveness, string> = {
  alive: "жив",
  stale: "stale",
  missing: "нет host",
};

type CardProps = {
  snap: PipelineMonitorSnapshot;
  busyPipeline: PipelineKey | null;
  canPause: boolean;
  canResume: boolean;
  onPause: () => void;
  onResume: () => void;
};

/** Карточка мониторинга одного pipeline-раннера. */
function PipelineMonitorCard({
  snap,
  busyPipeline,
  canPause,
  canResume,
  onPause,
  onResume,
}: CardProps) {
  const busy = busyPipeline !== null;
  const queueTotal = snap.queue.pending + snap.queue.processing;
  const showRunProgress = snap.progressStats != null && snap.activity !== "offline";
  const showRebuild =
    snap.activity === "rebuild" && snap.rebuildPercent != null;
  const showTrackingProgress =
    snap.pipelineKey === "tracking" &&
    snap.trackingPercent != null &&
    (snap.activity === "running" || snap.activity === "draining");

  return (
    <Panel
      title={PIPELINE_LABELS[snap.pipelineKey]}
      actions={<RuntimeBadge runtime={snap.runtime} />}
    >
      <div className="ds-metric-row">
        <span className="ds-metric-row__label">Runner</span>
        <span className="ds-metric-row__value">
          <StatusDot
            kind={LIVENESS_KIND[snap.hostLiveness]}
            label={
              snap.hostId
                ? `${snap.hostId} · ${LIVENESS_LABEL[snap.hostLiveness]}`
                : LIVENESS_LABEL[snap.hostLiveness]
            }
          />
        </span>
      </div>

      <div className="ds-metric-row">
        <span className="ds-metric-row__label">Activity</span>
        <span className="ds-metric-row__value">
          <StatusDot
            kind={ACTIVITY_KIND[snap.activity]}
            label={ACTIVITY_LABEL[snap.activity]}
            pulse={snap.activity === "running" || snap.activity === "rebuild"}
          />
          {snap.detail ? (
            <span className="ds-muted" style={{ marginLeft: 6, fontSize: 10 }}>
              {snap.detail}
              {snap.rebuildPhase ? ` · ${snap.rebuildPhase}` : ""}
            </span>
          ) : null}
        </span>
      </div>

      <div className="ds-metric-row">
        <span className="ds-metric-row__label">Queue</span>
        <span className="ds-metric-row__value">
          {fmt(queueTotal)}
          <span className="ds-muted" style={{ marginLeft: 6, fontSize: 10 }}>
            p:{fmt(snap.queue.pending)} pr:{fmt(snap.queue.processing)}
          </span>
        </span>
      </div>

      {(showRunProgress || showRebuild || showTrackingProgress) && (
        <div className="ds-metric-row" style={{ alignItems: "center" }}>
          <span className="ds-metric-row__label">Progress</span>
          <span
            className="ds-metric-row__value"
            style={{ display: "flex", gap: 8, alignItems: "center", flex: 1 }}
          >
            {showRebuild && (
              <span style={{ fontSize: 12 }}>
                {snap.rebuildPercent!.toFixed(1)}%
                {snap.rebuildPhase ? ` · ${snap.rebuildPhase}` : ""}
              </span>
            )}
            {showTrackingProgress && (
              <span style={{ fontSize: 12 }}>{snap.trackingPercent!.toFixed(1)}%</span>
            )}
            {showRunProgress && snap.progressStats && (
              <PhaseRunProgressBar stats={snap.progressStats} />
            )}
          </span>
        </div>
      )}

      {snap.millStatus && (
        <div className="ds-metric-row">
          <span className="ds-metric-row__label">Mill</span>
          <span className="ds-muted" style={{ fontSize: 10 }}>
            {snap.millStatus}
            {snap.millLastTickAt ? ` · ${formatDateTime(snap.millLastTickAt)}` : ""}
          </span>
        </div>
      )}

      <div className="ds-metric-row" style={{ marginTop: 8 }}>
        <span className="ds-metric-row__label">Control</span>
        <span className="ds-metric-row__value" style={{ display: "flex", gap: 6 }}>
          <Button variant="ghost" disabled={busy || !canPause} onClick={onPause}>
            Pause
          </Button>
          <Button variant="ghost" disabled={busy || !canResume} onClick={onResume}>
            Resume
          </Button>
        </span>
      </div>
    </Panel>
  );
}

/** Панель живых worker-hosts (вместо пустых process/thread executors). */
function HostsPanel({
  rows,
}: {
  rows: ReturnType<typeof buildHostMonitorRows>;
}) {
  if (rows.length === 0) {
    return <p className="ds-muted">Нет obs_hosts — worker не шлёт heartbeat</p>;
  }

  return (
    <ul className="ds-log-list">
      {rows.map((row) => (
        <li key={row.hostId} className="ds-log-list__item" style={{ gap: 8, flexWrap: "wrap" }}>
          <StatusDot kind={LIVENESS_KIND[row.liveness]} label={row.hostId} />
          <span className="ds-muted" style={{ fontSize: 10 }}>
            {row.role}
          </span>
          <span style={{ fontSize: 10 }}>{formatDateTime(row.lastSeenAt)}</span>
          <span className="ds-muted" style={{ fontSize: 10 }}>
            {row.pipelines.map((p) => p.pipelineKey).join(", ") || "—"}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Runner Platform: существование host, activity (run/queue/rebuild), прогресс. */
export function RunnerDiscoveryWidget() {
  const discovery = useObservable(runnerDiscovery$, null);
  const phaseRuns = useObservable(phaseRuns$, []);
  const phasesOverview = useObservable(phasesOverview$, null);
  const parsePipeline = useObservable(parsePipelineStatus$, null);
  const trackingStatus = useObservable(trackingStatus$, null);
  const [busyPipeline, setBusyPipeline] = useState<PipelineKey | null>(null);

  if (!discovery) {
    return (
      <Panel title="Runner Platform">
        <p className="ds-muted">Загрузка…</p>
      </Panel>
    );
  }

  const cards = buildRunnerMonitor({
    discovery,
    phaseRuns,
    phasesOverview,
    parsePipeline,
    tracking: trackingStatus,
  });
  const hosts = buildHostMonitorRows(discovery.runtime.hosts);

  const onPause = async (pipelineKey: PipelineKey): Promise<void> => {
    setBusyPipeline(pipelineKey);
    try {
      if (pipelineKey === "tracking") {
        await adminApi.trackingPause();
      } else {
        const run = findActivePhaseRun(pipelineKey, phaseRuns, discovery.workbook.registry);
        if (!run) return;
        await adminApi.phasesPauseRun(run.id);
      }
      await refreshRunnerDiscovery();
    } catch (error) {
      reportAppError("Pause", error);
    } finally {
      setBusyPipeline(null);
    }
  };

  const onResume = async (pipelineKey: PipelineKey): Promise<void> => {
    setBusyPipeline(pipelineKey);
    try {
      if (pipelineKey === "tracking") {
        await adminApi.trackingResume();
      } else {
        const run = findActivePhaseRun(pipelineKey, phaseRuns, discovery.workbook.registry);
        if (!run) return;
        await adminApi.phasesResumeRun(run.id);
      }
      await refreshRunnerDiscovery();
    } catch (error) {
      reportAppError("Resume", error);
    } finally {
      setBusyPipeline(null);
    }
  };

  const canPause = (snap: PipelineMonitorSnapshot): boolean => {
    if (snap.pipelineKey === "tracking") {
      return (
        (snap.activity === "running" || snap.activity === "draining") &&
        !trackingStatus?.paused
      );
    }
    return snap.activeRun?.status === "running";
  };

  const canResume = (snap: PipelineMonitorSnapshot): boolean => {
    if (snap.pipelineKey === "tracking") {
      return snap.activity === "paused" || trackingStatus?.paused === true;
    }
    return snap.activeRun?.status === "paused" || snap.activity === "paused";
  };

  return (
    <div className="admin-discovery">
      <div className="admin-grid">
        {cards.map((snap) => (
          <div key={snap.pipelineKey} className="admin-grid__cell admin-grid__cell--4">
            <PipelineMonitorCard
              snap={snap}
              busyPipeline={busyPipeline}
              canPause={canPause(snap)}
              canResume={canResume(snap)}
              onPause={() => void onPause(snap.pipelineKey)}
              onResume={() => void onResume(snap.pipelineKey)}
            />
          </div>
        ))}
      </div>

      <Panel title="Hosts (worker)" className="admin-discovery__executors">
        <HostsPanel rows={hosts} />
        <p className="ds-muted" style={{ fontSize: 10, marginTop: 12 }}>
          generatedAt: {discovery.generatedAt}
        </p>
      </Panel>
    </div>
  );
}
