import { useCallback, useState } from "react";
import type { PipelineTopologyResponse } from "@radar/shared";
import { Button, Panel } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import { adminApi } from "../../shared/api/adminApi";
import { pipelineTopology$ } from "../../shared/state/adminStore";
import { reportAppError } from "../../shared/state/appLogStore";
import { fmt } from "../components/statsOverviewParts";

/** Карта declarative pipeline steps: run / isolate / reset с dryRun preview. */
export function PipelineMapWidget() {
  const topology = useObservable(pipelineTopology$, null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isolateHighlight, setIsolateHighlight] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      pipelineTopology$.next(await adminApi.pipelineTopology());
    } catch (err) {
      reportAppError("Pipeline map", err);
    }
  }, []);

  const runStep = async (stepId: string, isolate: boolean): Promise<void> => {
    setBusy(`${stepId}:run`);
    setNotice(null);
    try {
      const res = await adminApi.pipelineStepRun(stepId, { isolate, lane: "manual" });
      setIsolateHighlight(isolate ? stepId : null);
      setNotice(`Run ${stepId}${isolate ? " (isolate)" : ""} · event ${res.eventId.slice(0, 8)}`);
      await refresh();
    } catch (err) {
      reportAppError("Pipeline run", err);
    } finally {
      setBusy(null);
    }
  };

  const resetStep = async (stepId: string): Promise<void> => {
    setBusy(`${stepId}:reset`);
    setNotice(null);
    try {
      const preview = await adminApi.pipelineStepReset(stepId, { cascade: true, dryRun: true });
      const lines = Object.entries(preview.countsByStep)
        .map(([id, counts]) => {
          const parts = Object.entries(counts)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ");
          return `• ${id}: ${parts || "—"}`;
        })
        .join("\n");
      if (
        !window.confirm(
          `Reset step «${stepId}» (cascade)?\n\nPreview:\n${lines || "(пусто)"}\n\nПрименить?`,
        )
      ) {
        return;
      }
      const applied = await adminApi.pipelineStepReset(stepId, { cascade: true, dryRun: false });
      setNotice(
        `Reset ${stepId} published${applied.eventId ? ` · ${applied.eventId.slice(0, 8)}` : ""}`,
      );
      await refresh();
    } catch (err) {
      reportAppError("Pipeline reset", err);
    } finally {
      setBusy(null);
    }
  };

  if (!topology) {
    return (
      <Panel title="Pipeline map">
        <p className="ds-muted">Загрузка topology…</p>
      </Panel>
    );
  }

  return (
    <Panel
      title="Pipeline map"
      actions={
        <Button variant="ghost" onClick={() => void refresh()}>
          Обновить
        </Button>
      }
    >
      {notice && (
        <p style={{ fontSize: 12, color: "var(--status-ok)", margin: "0 0 8px" }}>{notice}</p>
      )}
      {topology.isolateStepId && (
        <p className="ds-muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
          Active isolate: {topology.isolateStepId}
        </p>
      )}

      <div className="admin-pipeline admin-pipeline--map">
        {topology.nodes.map((node, i) => {
          const outEdges = topology.edges.filter((e) => e.fromStepId === node.id);
          const highlight =
            isolateHighlight === node.id || topology.isolateStepId === node.id;
          return (
            <div key={node.id} className="admin-pipeline__step">
              {i > 0 && (
                <span
                  className={
                    topology.edges.some(
                      (e) =>
                        e.toStepId === node.id &&
                        (e.suppressed ||
                          (isolateHighlight != null && e.fromStepId === isolateHighlight)),
                    )
                      ? "admin-pipeline__arrow admin-pipeline__arrow--suppressed"
                      : "admin-pipeline__arrow"
                  }
                  aria-hidden
                >
                  →
                </span>
              )}
              <div
                className="admin-pipeline__body"
                style={{
                  outline: highlight ? "1px solid var(--accent)" : undefined,
                  opacity: node.enabled ? 1 : 0.55,
                }}
              >
                <span className="admin-pipeline__label" title={node.pipelineKey}>
                  {node.label ?? node.id}
                </span>
                <span className="admin-pipeline__value">{node.id}</span>
                <span className="admin-pipeline__sub">
                  {node.queueDepth
                    ? `q ${fmt(node.queueDepth.pending + node.queueDepth.processing)}`
                    : node.kind}
                  {node.lastStepRun ? ` · ${node.lastStepRun.status}` : ""}
                </span>
                {outEdges.length > 0 && (
                  <span className="admin-pipeline__sub" title={outEdges.map((e) => e.key).join(", ")}>
                    emits {outEdges.length}
                    {outEdges.some((e) => e.suppressed) ? " · suppressed" : ""}
                  </span>
                )}
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                  <Button
                    variant="ghost"
                    disabled={busy != null}
                    onClick={() => void runStep(node.id, false)}
                  >
                    Run
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy != null}
                    title="Isolate: без downstream emits"
                    onClick={() => void runStep(node.id, true)}
                  >
                    Isolate
                  </Button>
                  {node.resetsHandler && (
                    <Button
                      variant="danger"
                      disabled={busy != null}
                      onClick={() => void resetStep(node.id)}
                    >
                      Reset
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/** @internal — для тестов/типов */
export type { PipelineTopologyResponse };
