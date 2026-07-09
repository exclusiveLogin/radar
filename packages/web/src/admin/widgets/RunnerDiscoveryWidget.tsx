import { useState, type ReactNode } from "react";
import type {
  ObsPipelineRuntime,
  PhaseRun,
  PipelineKey,
  RunnerDiscoveryResponse,
  WorkbookRegistryEntry,
} from "@radar/shared";
import { Button, Panel } from "../../shared/ds";
import { adminApi } from "../../shared/api/adminApi";
import { useObservable } from "../../shared/hooks/useObservable";
import {
  phaseRuns$,
  refreshRunnerDiscovery,
  runnerDiscovery$,
  trackingStatus$,
} from "../../shared/state/adminStore";
import { reportAppError } from "../../shared/state/appLogStore";
import { ExecutorsPanel } from "../components/ExecutorsPanel";
import { RuntimeBadge } from "../components/RuntimeBadge";
import { fmt } from "../components/statsOverviewParts";

const PIPELINE_KEYS: PipelineKey[] = ["tracking", "parse", "geo-enrich"];

const PIPELINE_LABELS: Record<PipelineKey, string> = {
  tracking: "Треки",
  parse: "Парсинг",
  "geo-enrich": "Гео",
};

/** Runtime badge: odpRuntime на host → fallback workload.runtime. */
function resolvePipelineRuntime(
  discovery: RunnerDiscoveryResponse,
  pipelineKey: PipelineKey,
): ObsPipelineRuntime | null {
  for (const host of discovery.runtime.hosts) {
    const entry = host.odpRuntime.find((row) => row.pipelineKey === pipelineKey);
    if (entry) return entry.runtime;
  }
  const workload = discovery.runtime.workloads.find((row) => row.pipelineKey === pipelineKey);
  return workload?.runtime ?? null;
}

/** Workload status: obs workload → fallback workbook activeWorkload. */
function resolveWorkloadStatus(discovery: RunnerDiscoveryResponse, pipelineKey: PipelineKey): string {
  const obsWorkload = discovery.runtime.workloads.find((row) => row.pipelineKey === pipelineKey);
  if (obsWorkload) return obsWorkload.status;
  const wbWorkload = discovery.workbook.activeWorkloads.find((row) => row.pipelineKey === pipelineKey);
  return wbWorkload?.status ?? "idle";
}

function sumTriggers(discovery: RunnerDiscoveryResponse, pipelineKey: PipelineKey): number {
  return discovery.runtime.triggerCounters
    .filter((row) => row.pipelineKey === pipelineKey)
    .reduce((sum, row) => sum + row.count, 0);
}

function materializeCount(discovery: RunnerDiscoveryResponse, pipelineKey: PipelineKey): number {
  return (
    discovery.runtime.materializeCounters.find((row) => row.pipelineKey === pipelineKey)?.count ?? 0
  );
}

function findActivePhaseRun(
  pipelineKey: "parse" | "geo-enrich",
  runs: PhaseRun[],
  registry: WorkbookRegistryEntry[],
): PhaseRun | null {
  const phaseIds = new Set(
    registry.find((entry) => entry.pipelineKey === pipelineKey)?.phases.map((phase) => phase.id) ?? [],
  );
  return (
    runs.find(
      (run) => phaseIds.has(run.phaseId) && (run.status === "running" || run.status === "paused"),
    ) ?? null
  );
}

/** 5×3 grid discovery + executors + pause/resume без worker probe. */
export function RunnerDiscoveryWidget() {
  const discovery = useObservable(runnerDiscovery$, null);
  const phaseRuns = useObservable(phaseRuns$, []);
  const trackingStatus = useObservable(trackingStatus$, null);
  const [busyPipeline, setBusyPipeline] = useState<PipelineKey | null>(null);

  if (!discovery) {
    return (
      <Panel title="Runner Platform · Discovery">
        <p className="ds-muted">Загрузка…</p>
      </Panel>
    );
  }

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

  const canPause = (pipelineKey: PipelineKey): boolean => {
    const status = resolveWorkloadStatus(discovery, pipelineKey);
    if (pipelineKey === "tracking") {
      return status === "running" && !trackingStatus?.paused;
    }
    const run = findActivePhaseRun(pipelineKey, phaseRuns, discovery.workbook.registry);
    return run?.status === "running";
  };

  const canResume = (pipelineKey: PipelineKey): boolean => {
    const status = resolveWorkloadStatus(discovery, pipelineKey);
    if (pipelineKey === "tracking") {
      return status === "paused" || trackingStatus?.paused === true;
    }
    const run = findActivePhaseRun(pipelineKey, phaseRuns, discovery.workbook.registry);
    return run?.status === "paused" || status === "paused";
  };

  const rows: Array<{ label: string; render: (key: PipelineKey) => ReactNode }> = [
    {
      label: "Runtime",
      render: (key) => <RuntimeBadge runtime={resolvePipelineRuntime(discovery, key)} />,
    },
    {
      label: "Workload",
      render: (key) => <span>{resolveWorkloadStatus(discovery, key)}</span>,
    },
    {
      label: "Triggers Σ",
      render: (key) => <span>{fmt(sumTriggers(discovery, key))}</span>,
    },
    {
      label: "Materialize",
      render: (key) => <span>{fmt(materializeCount(discovery, key))}</span>,
    },
    {
      label: "Control",
      render: (key) => (
        <div style={{ display: "flex", gap: 6 }}>
          <Button
            variant="ghost"
            disabled={busyPipeline !== null || !canPause(key)}
            onClick={() => void onPause(key)}
          >
            Pause
          </Button>
          <Button
            variant="ghost"
            disabled={busyPipeline !== null || !canResume(key)}
            onClick={() => void onResume(key)}
          >
            Resume
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Panel title="Runner Platform · Discovery">
      <table className="ds-table" style={{ width: "100%", fontSize: 12, marginBottom: 16 }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Метрика</th>
            {PIPELINE_KEYS.map((key) => (
              <th key={key}>{PIPELINE_LABELS[key]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td style={{ color: "var(--text-muted)" }}>{row.label}</td>
              {PIPELINE_KEYS.map((key) => (
                <td key={key}>{row.render(key)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <section>
        <h4 style={{ margin: "0 0 8px", fontSize: 12 }}>Executors (process + thread)</h4>
        <ExecutorsPanel
          hosts={discovery.runtime.hosts}
          executors={discovery.runtime.executors}
        />
      </section>

      <p className="ds-muted" style={{ fontSize: 10, marginTop: 12 }}>
        generatedAt: {discovery.generatedAt}
      </p>
    </Panel>
  );
}
