import { useEffect, useState } from "react";
import type { WorkbookObservabilityResponse } from "@radar/shared";
import { Panel, StatusDot } from "../../shared/ds";
import { adminApi } from "../../shared/api/adminApi";
import { reportAppError } from "../../shared/state/appLogStore";
import { formatDateTime } from "../format";

const PIPELINE_LABELS: Record<string, string> = {
  tracking: "Треки",
  parse: "Парсинг",
  "geo-enrich": "Гео-обогащение",
};

function pipelineLabel(pipelineKey: string): string {
  return PIPELINE_LABELS[pipelineKey] ?? pipelineKey;
}

/**
 * Workbook Registry / Active Workloads / Run History по всем pipeline (tracking/parse/geo-enrich).
 * Источник — GET /api/admin/workbook/observability (read-side фасад над уже существующими
 * tracking/phases admin-эндпоинтами, без доступа к runner-platform internals).
 */
export function WorkbookObservabilityWidget() {
  const [data, setData] = useState<WorkbookObservabilityResponse | null>(null);

  useEffect(() => {
    void adminApi
      .workbookObservability()
      .then(setData)
      .catch((e) => reportAppError("Workbook observability", e));
  }, []);

  if (!data) {
    return (
      <Panel title="Workbook observability">
        <span className="ds-metric-row__value">Загрузка…</span>
      </Panel>
    );
  }

  return (
    <Panel title="Workbook observability">
      <div style={{ display: "grid", gap: 16 }}>
        <section>
          <h4 style={{ margin: "0 0 6px" }}>Registry</h4>
          {data.registry.map((entry) => (
            <div key={entry.pipelineKey} className="ds-metric-row">
              <span className="ds-metric-row__label">{pipelineLabel(entry.pipelineKey)}</span>
              <span className="ds-metric-row__value">
                {entry.phases.map((phase) => `${phase.id}${phase.enabled ? "" : " (off)"}`).join(", ") || "—"}
              </span>
            </div>
          ))}
        </section>

        <section>
          <h4 style={{ margin: "0 0 6px" }}>Active workloads</h4>
          {data.activeWorkloads.length === 0 && (
            <span className="ds-metric-row__value">Нет активных workload</span>
          )}
          {data.activeWorkloads.map((workload, i) => (
            <div key={`${workload.pipelineKey}-${i}`} className="ds-metric-row">
              <span className="ds-metric-row__label">
                {pipelineLabel(workload.pipelineKey)}
                {workload.currentPhaseId ? ` · ${workload.currentPhaseId}` : ""}
              </span>
              <StatusDot
                kind={workload.status === "running" ? "ok" : workload.status === "paused" ? "warn" : "neutral"}
                label={workload.status}
              />
            </div>
          ))}
        </section>

        <section>
          <h4 style={{ margin: "0 0 6px" }}>Run history</h4>
          <table className="ds-table" style={{ width: "100%", fontSize: 12 }}>
            <thead>
              <tr>
                <th>Pipeline</th>
                <th>Старт</th>
                <th>Outcome</th>
                <th>Длительность</th>
              </tr>
            </thead>
            <tbody>
              {data.runHistory.map((run) => (
                <tr key={run.runId}>
                  <td>{pipelineLabel(run.pipelineKey)}</td>
                  <td>{formatDateTime(run.startedAt)}</td>
                  <td>{run.outcome}</td>
                  <td>{run.durationMs != null ? `${Math.round(run.durationMs / 1000)}s` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </Panel>
  );
}
