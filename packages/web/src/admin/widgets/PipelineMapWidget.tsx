import { useCallback, useState } from "react";
import type {
  PipelineTopologyEdge,
  PipelineTopologyNode,
  PipelineTopologyResponse,
} from "@radar/shared";
import { Button, Panel } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import { adminApi } from "../../shared/api/adminApi";
import { pipelineTopology$ } from "../../shared/state/adminStore";
import { reportAppError } from "../../shared/state/appLogStore";
import { fmt } from "../components/statsOverviewParts";
import { layoutPipelineColumns, shortRoutingKey } from "../pipelineMapLayout";

const STATUS_TONE: Record<string, string> = {
  running: "var(--status-warn)",
  drained: "var(--status-ok)",
  completed: "var(--status-ok)",
  failed: "var(--status-error)",
};

/** Карта declarative pipeline steps: граф из topology DSL + run / isolate / reset. */
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

  const layout = layoutPipelineColumns(topology.nodes, topology.edges);
  const activeIsolate = isolateHighlight ?? topology.isolateStepId;

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
        <div
          className="admin-pipeline__columns"
          style={{
            gridTemplateColumns: `repeat(${Math.max(layout.columns.length, 1)}, minmax(140px, 1fr))`,
          }}
        >
          {layout.columns.map((col) => (
            <div key={col.rank} className="admin-pipeline__column">
              <span className="admin-pipeline__column-rank">L{col.rank}</span>
              {col.nodes.map((node) => (
                <StepCard
                  key={node.id}
                  node={node}
                  highlight={activeIsolate === node.id}
                  busy={busy != null}
                  onRun={() => void runStep(node.id, false)}
                  onIsolate={() => void runStep(node.id, true)}
                  onReset={
                    node.resetsHandler ? () => void resetStep(node.id) : undefined
                  }
                />
              ))}
            </div>
          ))}
        </div>

        <EdgeList
          edges={layout.edges.map((e) => ({ ...e, suppressed: e.suppressed ?? false }))}
          isolateStepId={activeIsolate}
        />
      </div>
    </Panel>
  );
}

function StepCard(props: {
  node: PipelineTopologyNode;
  highlight: boolean;
  busy: boolean;
  onRun: () => void;
  onIsolate: () => void;
  onReset?: () => void;
}) {
  const { node, highlight, busy, onRun, onIsolate, onReset } = props;
  const status = node.lastStepRun?.status;
  const statusColor = status ? (STATUS_TONE[status] ?? "var(--text-muted)") : undefined;
  const q = node.queueDepth;

  return (
    <div
      className="admin-pipeline__body admin-pipeline__body--card"
      style={{
        outline: highlight ? "1px solid var(--accent)" : undefined,
        opacity: node.enabled ? 1 : 0.55,
      }}
    >
      <div className="admin-pipeline__card-head">
        <span className="admin-pipeline__label" title={node.pipelineKey}>
          {node.label ?? node.id}
        </span>
        {status && (
          <span
            className="admin-pipeline__badge"
            style={{ color: statusColor }}
            title={node.lastStepRun?.id}
          >
            {status}
          </span>
        )}
      </div>
      <span className="admin-pipeline__value">{node.id}</span>
      <span className="admin-pipeline__sub">
        {node.kind}
        {q ? ` · q p:${fmt(q.pending)} pr:${fmt(q.processing)}` : ""}
      </span>
      {node.phases.length > 0 && (
        <span className="admin-pipeline__phases" title="phases в scope шага">
          {node.phases
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((p) => `${p.id}${p.enabled ? "" : "✗"}`)
            .join(" · ")}
        </span>
      )}
      <div className="admin-pipeline__actions">
        <Button variant="ghost" disabled={busy} onClick={onRun}>
          Run
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          title="Isolate: без downstream emits"
          onClick={onIsolate}
        >
          Isolate
        </Button>
        {onReset && (
          <Button variant="danger" disabled={busy} onClick={onReset}>
            Reset
          </Button>
        )}
      </div>
    </div>
  );
}

function EdgeList(props: {
  edges: PipelineTopologyEdge[];
  isolateStepId: string | null;
}) {
  const { edges, isolateStepId } = props;
  if (edges.length === 0) {
    return <p className="admin-pipeline__edges-empty ds-muted">Нет рёбер emits→trigger</p>;
  }

  return (
    <ul className="admin-pipeline__edges">
      {edges.map((e) => {
        const suppressed =
          e.suppressed ||
          (isolateStepId != null && e.fromStepId === isolateStepId);
        return (
          <li
            key={`${e.fromStepId}->${e.toStepId}:${e.key}`}
            className={
              suppressed
                ? "admin-pipeline__edge admin-pipeline__edge--suppressed"
                : "admin-pipeline__edge"
            }
          >
            <code>{e.fromStepId}</code>
            <span aria-hidden>→</span>
            <code>{e.toStepId}</code>
            <span className="admin-pipeline__edge-key" title={e.key}>
              {shortRoutingKey(e.key)}
            </span>
            {suppressed && <span className="admin-pipeline__edge-flag">suppressed</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** @internal — для тестов/типов */
export type { PipelineTopologyResponse };
