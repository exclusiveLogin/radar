import { useState } from "react";
import { Button, Panel } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import { adminApi } from "../../shared/api/adminApi";
import {
  parsePipelineStatus$,
  refreshParsePipelineStatus,
} from "../../shared/state/adminStore";
import { reportAppError } from "../../shared/state/appLogStore";

const STATUS_LABEL: Record<string, string> = {
  idle: "ожидание",
  running: "выполняется",
  completed: "готово",
  failed: "ошибка",
};

const KIND_LABEL: Record<string, string> = {
  reset: "Pipeline reset",
  catchup: "Parse catch-up",
};

/** Операции parse pipeline: destructive reset и безопасный catch-up очереди. */
export function ParsePipelineWidget() {
  const status = useObservable(parsePipelineStatus$, null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await refreshParsePipelineStatus();
    } catch (e) {
      reportAppError("Parse pipeline", e);
    } finally {
      setBusy(false);
    }
  };

  const isRunning = status?.status === "running";
  const percent = status?.percentApprox ?? 0;
  const processed = status?.processedMessages ?? 0;
  const total = status?.totalMessages ?? 0;

  return (
    <Panel title="Parse pipeline">
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 10px" }}>
        Catch-up добавляет только отсутствующие raw в очередь и разбирает их батчами без очистки
        таблиц.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Button
          variant="ghost"
          disabled={busy || isRunning}
          onClick={() => {
            if (
              !window.confirm(
                "Pipeline reset: очистить parsed, parse_attempts, карту и очереди фаз (raw остаётся)?",
              )
            ) {
              return;
            }
            void run(() => adminApi.parsePipelineReset());
          }}
        >
          Reset
        </Button>
        <Button
          variant="ghost"
          disabled={busy || isRunning}
          onClick={() => {
            if (
              !window.confirm(
                "Parse catch-up: поставить необработанные raw в очередь и разобрать батчами?",
              )
            ) {
              return;
            }
            void run(() => adminApi.parsePipelineCatchUp());
          }}
        >
          Catch-up
        </Button>
        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
          {status?.kind ? KIND_LABEL[status.kind] ?? status.kind : "—"} ·{" "}
          {STATUS_LABEL[status?.status ?? "idle"] ?? status?.status}
        </span>
        {status?.kind === "catchup" && (
          <span>
            {processed.toLocaleString()} / {total.toLocaleString()} ({percent.toFixed(1)}%)
          </span>
        )}
        {status?.kind === "catchup" && (
          <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
            ok {status.ok.toLocaleString()} · fail {status.failed.toLocaleString()}
          </span>
        )}
      </div>

      {status?.kind === "catchup" && (
        <div
          style={{
            marginTop: 8,
            height: 8,
            background: "var(--surface-2)",
            borderRadius: 4,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${percent}%`,
              height: "100%",
              background: status.status === "failed" ? "var(--danger)" : "var(--accent)",
              transition: "width 0.3s ease",
            }}
          />
        </div>
      )}

      {status?.status === "running" && status.kind === "reset" && (
        <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
          Сброс выполняется…
        </p>
      )}

      {status?.error && (
        <p style={{ fontSize: 11, color: "var(--danger)", marginTop: 8, whiteSpace: "pre-wrap" }}>
          {status.error}
        </p>
      )}

      {status?.finishedAt && status.status !== "running" && (
        <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
          Завершено: {new Date(status.finishedAt).toLocaleString()}
        </p>
      )}
    </Panel>
  );
}
