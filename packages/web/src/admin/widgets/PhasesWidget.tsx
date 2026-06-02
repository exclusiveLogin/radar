import { useCallback, useEffect, useState } from "react";
import type { PhaseDefinition, PhaseRun, PhaseRunsOverview } from "@radar/shared";
import { Button, Panel } from "../../shared/ds";
import { adminApi } from "../../shared/api/adminApi";
import { formatDateTime } from "../format";
import { PhaseRunProgressBar } from "./PhaseRunProgressBar";

const POLL_MS = 10_000;

const STATUS_COLOR: Record<string, string> = {
  completed: "var(--status-ok)",
  running: "var(--status-warn)",
  paused: "var(--status-warn)",
  failed: "var(--status-error)",
  canceled: "var(--text-muted)",
  pending: "var(--text-muted)",
};

const ACTIVE_RUN_STATUSES = new Set(["running", "paused", "pending"]);

type QueueCounts = { pending: number; processing: number; done: number; failed: number };

function formatQueue(c: QueueCounts): string {
  return `p:${c.pending} pr:${c.processing} d:${c.done} f:${c.failed}`;
}

type PhaseRowProps = {
  phaseId: string;
  trigger: string;
  enabled: boolean;
  queueLabel: string;
  queue: QueueCounts;
  onToggle: () => void;
  onRun: () => void;
  onClearQueue?: () => void;
  runTitle: string;
};

function PhaseRow({
  phaseId,
  trigger,
  enabled,
  queueLabel,
  queue,
  onToggle,
  onRun,
  onClearQueue,
  runTitle,
}: PhaseRowProps) {
  const queued = queue.pending + queue.processing;
  return (
    <li className="ds-log-list__item" style={{ gap: 6, flexWrap: "wrap" }}>
      <span style={{ fontWeight: 600, minWidth: 88 }}>{phaseId}</span>
      <span style={{ color: "var(--text-muted)", fontSize: 10 }}>{trigger}</span>
      <span style={{ fontSize: 10 }} title={queueLabel}>
        {formatQueue(queue)}
      </span>
      <Button
        variant={enabled ? "primary" : "ghost"}
        title={enabled ? "Выключить фазу" : "Включить фазу"}
        onClick={onToggle}
      >
        {enabled ? "ВКЛ" : "ВЫКЛ"}
      </Button>
      <Button variant="ghost" title={runTitle} onClick={onRun}>
        Run
      </Button>
      {onClearQueue && queued > 0 && (
        <Button
          variant="danger"
          title="Удалить pending/processing в очереди этой фазы"
          onClick={onClearQueue}
        >
          Сброс оч.
        </Button>
      )}
    </li>
  );
}

/** Parse-engine: ingest (raw) и geo (places) — отдельные секции и тогглы. */
export function PhasesWidget() {
  const [phases, setPhases] = useState<PhaseDefinition[]>([]);
  const [runs, setRuns] = useState<PhaseRun[]>([]);
  const [overview, setOverview] = useState<PhaseRunsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stopAllBusy, setStopAllBusy] = useState(false);
  const [stopAllNotice, setStopAllNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [phaseList, recentRuns, ov] = await Promise.all([
        adminApi.phasesList(),
        adminApi.phasesRuns({ limit: 20 }),
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

  const clearPhaseQueue = async (phaseId: string): Promise<void> => {
    if (!window.confirm(`Сбросить очередь фазы ${phaseId}? (pending/processing)`)) return;
    const result = await adminApi.phasesClearQueue(phaseId);
    setStopAllNotice(`Очередь ${phaseId}: −${result.cleared}, runs: ${result.runsCanceled}`);
    await refresh();
  };

  const stopAllRuns = async (): Promise<void> => {
    if (
      !window.confirm(
        "Остановить все runs?\n\nIngest: cancel + очистка phase_coverage.\nGeo: cancel + очистка place_enrichment_jobs (pending/processing).",
      )
    ) {
      return;
    }
    setStopAllBusy(true);
    setStopAllNotice(null);
    try {
      const result = await adminApi.phasesStopAllRuns();
      setStopAllNotice(
        `Runs: ${result.phaseRunsClosed}, ingest queue: ${result.queueCleared}, geo jobs: ${result.geoJobsCleared}`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось остановить runs");
    } finally {
      setStopAllBusy(false);
    }
  };

  const ingestPhases = phases.filter((p) => p.scope === "ingestParse");
  const geoPhases = phases.filter((p) => p.scope === "geoParse");

  const queueBacklog = (counts: QueueCounts): number => counts.pending + counts.processing;

  const hasQueueBacklog =
    (overview?.ingest.byPhase.some((p) => queueBacklog(p.coverage) > 0) ?? false) ||
    (overview?.geo.byPhase.some((p) => queueBacklog(p.jobs) > 0) ?? false);

  const hasActiveRuns =
    (overview?.runningCount ?? 0) > 0 ||
    runs.some((r) => ACTIVE_RUN_STATUSES.has(r.status));

  const canStopAll = hasActiveRuns || hasQueueBacklog;

  return (
    <Panel title="Parse-engine">
      {error && <p style={{ color: "var(--status-error)" }}>{error}</p>}

      <section style={{ marginBottom: 16 }}>
        <h4 style={{ fontSize: 12, margin: "0 0 4px" }}>Ingest — сообщения → parsed_events</h4>
        <p style={{ fontSize: 10, color: "var(--text-muted)", margin: "0 0 8px", lineHeight: 1.35 }}>
          Очередь <code>phase_coverage</code> (raw × фаза). Catalog eager inline после ingest;
          scheduled (llm) — IngestParseDaemon. DaData — только geo-dadata.
        </p>
        <ul className="ds-log-list">
          {ingestPhases.map((phase) => {
            const row = overview?.ingest.byPhase.find((p) => p.phaseId === phase.id);
            return (
              <PhaseRow
                key={phase.id}
                phaseId={phase.id}
                trigger={phase.trigger}
                enabled={phase.enabled}
                queueLabel="phase_coverage"
                queue={row?.coverage ?? { pending: 0, processing: 0, done: 0, failed: 0 }}
                onToggle={() => void toggle(phase)}
                onRun={() => void runPhase(phase.id)}
                onClearQueue={() => void clearPhaseQueue(phase.id)}
                runTitle="Manual: enqueue raw + drain (worker)"
              />
            );
          })}
        </ul>
      </section>

      <section style={{ marginBottom: 16 }}>
        <h4 style={{ fontSize: 12, margin: "0 0 4px" }}>Geo — каталог places</h4>
        <p style={{ fontSize: 10, color: "var(--text-muted)", margin: "0 0 8px", lineHeight: 1.35 }}>
          Очередь <code>place_enrichment_jobs</code>: places без провайдера в{" "}
          <code>evidence_providers</code>. Не зависит от парса. GeoParseDaemon / Run → catch-up + drain.
        </p>
        <ul className="ds-log-list">
          {geoPhases.map((phase) => {
            const row = overview?.geo.byPhase.find((p) => p.phaseId === phase.id);
            return (
              <PhaseRow
                key={phase.id}
                phaseId={phase.id}
                trigger={phase.trigger}
                enabled={phase.enabled}
                queueLabel={row?.provider ? `jobs:${row.provider}` : "jobs"}
                queue={row?.jobs ?? { pending: 0, processing: 0, done: 0, failed: 0 }}
                onToggle={() => void toggle(phase)}
                onRun={() => void runPhase(phase.id)}
                onClearQueue={() => void clearPhaseQueue(phase.id)}
                runTitle="Catch-up places + geo drain (нужен worker:dev)"
              />
            );
          })}
        </ul>
      </section>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          margin: "12px 0 4px",
        }}
      >
        <h4 style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
          Запуски · активных: {overview?.runningCount ?? "—"}
        </h4>
        <Button
          variant="danger"
          disabled={stopAllBusy || !canStopAll}
          title={
            canStopAll
              ? "Cancel runs + очистка ingest и geo очередей"
              : "Нет активных runs и нет pending/processing в очередях"
          }
          onClick={() => void stopAllRuns()}
        >
          {stopAllBusy ? "Останавливаем…" : "Стоп всё"}
        </Button>
      </div>
      {stopAllNotice && (
        <p style={{ fontSize: 10, color: "var(--status-ok)", margin: "0 0 6px" }}>{stopAllNotice}</p>
      )}
      <ul className="ds-log-list">
        {runs.map((run) => {
          const phase = phases.find((p) => p.id === run.phaseId);
          const scopeTag = phase?.scope === "geoParse" ? "geo" : "ingest";
          return (
            <li key={run.id} className="ds-log-list__item" style={{ gap: 8 }}>
              <span>
                [{scopeTag}] {run.phaseId} · {run.trigger}
              </span>
              <span style={{ color: STATUS_COLOR[run.status] }}>{run.status}</span>
              <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                ok={String(run.stats.ok ?? 0)} pending={String(run.stats.pendingRemaining ?? "?")}
              </span>
              <span style={{ fontSize: 10 }}>{formatDateTime(run.startedAt ?? run.createdAt)}</span>
              {ACTIVE_RUN_STATUSES.has(run.status) && (
                <>
                  <PhaseRunProgressBar stats={run.stats} />
                  <Button variant="ghost" onClick={() => void cancelRun(run.id)}>
                    Cancel
                  </Button>
                </>
              )}
              {run.status === "completed" && (run.stats.totalKnown ?? 0) > 0 && (
                <PhaseRunProgressBar stats={run.stats} />
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
