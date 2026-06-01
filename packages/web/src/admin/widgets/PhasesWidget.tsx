import { useCallback, useEffect, useState } from "react";
import type { PhaseDefinition, PhaseRun } from "@radar/shared";
import { Button, Panel } from "../../shared/ds";
import { adminApi } from "../../shared/api/adminApi";
import { formatDateTime } from "../format";

const POLL_MS = 10_000;

const STATUS_COLOR: Record<string, string> = {
  completed: "var(--status-ok)",
  running: "var(--status-warn)",
  paused: "var(--status-warn)",
  failed: "var(--status-error)",
  canceled: "var(--text-muted)",
  pending: "var(--text-muted)",
};

/** Phase-pipeline v2: фазы, coverage, runs, управление. */
export function PhasesWidget() {
  const [phases, setPhases] = useState<PhaseDefinition[]>([]);
  const [runs, setRuns] = useState<PhaseRun[]>([]);
  const [overview, setOverview] = useState<Awaited<
    ReturnType<typeof adminApi.phasesRunsOverview>
  > | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [phaseList, recentRuns, ov] = await Promise.all([
        adminApi.phasesList(),
        adminApi.phasesRuns({ limit: 15 }),
        adminApi.phasesRunsOverview(),
      ]);
      setPhases(phaseList);
      setRuns(recentRuns);
      setOverview(ov);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить фазы");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const toggle = async (phase: PhaseDefinition): Promise<void> => {
    await adminApi.phasesPatch(phase.id, { enabled: !phase.enabled });
    await refresh();
  };

  const runPhase = async (phaseId: string): Promise<void> => {
    await adminApi.phasesStartRun(phaseId, {});
    await refresh();
  };

  const cancelRun = async (runId: string): Promise<void> => {
    await adminApi.phasesCancelRun(runId);
    await refresh();
  };

  return (
    <Panel title="Фазы обогащения">
      {error && <p style={{ color: "var(--status-error)" }}>{error}</p>}

      <p style={{ fontSize: 10, color: "var(--text-muted)", margin: "0 0 6px", lineHeight: 1.35 }}>
        ВКЛ/ВЫКЛ — <code>phase_definitions.enabled</code>. p/d/f — coverage. Run: enqueue всех
        не-done + manual run; <code>worker:dev</code> гонит батчами до пустой claimable-очереди.
        Scheduled (llm) — один drain на фазу (батчами до пустой очереди), без параллельных runs.
      </p>
      <h4 style={{ fontSize: 11, color: "var(--text-muted)", margin: "8px 0 4px" }}>
        Фазы · {phases.length}
        {overview ? ` · активных runs: ${overview.runningCount}` : ""}
      </h4>
      <ul className="ds-log-list">
        {phases.map((phase) => {
          const cov = overview?.byPhase.find((p) => p.phaseId === phase.id)?.coverage;
          return (
            <li key={phase.id} className="ds-log-list__item" style={{ gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600, minWidth: 72 }}>{phase.id}</span>
              <span style={{ color: "var(--text-muted)", fontSize: 10 }}>{phase.trigger}</span>
              {cov && (
                <span style={{ fontSize: 10 }}>
                  p:{cov.pending} d:{cov.done} f:{cov.failed}
                </span>
              )}
              <Button
                variant={phase.enabled ? "primary" : "ghost"}
                title={
                  phase.enabled
                    ? "Фаза включена — нажмите, чтобы выключить"
                    : "Фаза выключена — нажмите, чтобы включить"
                }
                onClick={() => void toggle(phase)}
              >
                {phase.enabled ? "ВКЛ" : "ВЫКЛ"}
              </Button>
              <Button
                variant="ghost"
                title="Ручной запуск (enqueue + phase_run; исполняет worker)"
                onClick={() => void runPhase(phase.id)}
              >
                Run
              </Button>
            </li>
          );
        })}
      </ul>

      <h4 style={{ fontSize: 11, color: "var(--text-muted)", margin: "12px 0 4px" }}>
        Запуски
      </h4>
      <ul className="ds-log-list">
        {runs.map((run) => (
          <li key={run.id} className="ds-log-list__item" style={{ gap: 8 }}>
            <span>
              {run.phaseId} · {run.trigger}
            </span>
            <span style={{ color: STATUS_COLOR[run.status] }}>{run.status}</span>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
              ok={String(run.stats.ok ?? 0)} pending={String(run.stats.pendingRemaining ?? "?")}
            </span>
            <span style={{ fontSize: 10 }}>{formatDateTime(run.startedAt ?? run.createdAt)}</span>
            {run.status === "running" && (
              <Button variant="ghost" onClick={() => void cancelRun(run.id)}>
                Cancel
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
