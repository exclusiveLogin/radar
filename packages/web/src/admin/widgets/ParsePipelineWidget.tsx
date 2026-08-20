import { useEffect, useState } from "react";
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

const PHASE_LABEL: Record<string, string> = {
  wiping: "1/3 Очистка",
  enqueueing: "2/3 Очередь",
  processing: "3/3 Разбор",
};

function formatElapsed(startedAt: string | null | undefined): string | null {
  if (!startedAt) return null;
  const ms = Date.now() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}м ${s}с` : `${s}с`;
}

/** Единая операция: wipe parse-слоя + enqueue catch-up. */
export function ParsePipelineWidget() {
  const status = useObservable(parsePipelineStatus$, null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const isRunning = status?.status === "running";

  // Тик каждую секунду, чтобы elapsed не замирал на длинном wipe.
  useEffect(() => {
    if (!isRunning) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [isRunning]);

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

  const releaseStuck = () =>
    run(async () => {
      setNotice(null);
      const result = await adminApi.parsePipelineReleaseStuck();
      setNotice(
        result.released > 0
          ? `Возвращено в очередь: ${result.released} (${result.phaseIds.join(", ")})`
          : "Зависших задач нет",
      );
    });

  const percent = status?.percentApprox ?? 0;
  const processed = status?.processedMessages ?? 0;
  const total = status?.totalMessages ?? 0;
  const showQueueProgress = status?.kind === "rebuild" && total > 0;
  const elapsed = formatElapsed(status?.startedAt);
  const phaseLabel = status?.phase ? PHASE_LABEL[status.phase] ?? status.phase : null;

  return (
    <Panel title="Parse pipeline">
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 10px" }}>
        Rebuild: остановить фазы → очистить parsed → поставить raw в очередь → разобрать.
        Архив raw не трогается. Wipe на большой БД может идти 1–3 минуты — это нормально.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Button
          variant="ghost"
          disabled={busy || isRunning}
          onClick={() => {
            if (
              !window.confirm(
                "Parse rebuild: очистить parsed и заново разобрать raw из архива?",
              )
            ) {
              return;
            }
            void run(() => adminApi.parsePipelineRebuild());
          }}
        >
          Rebuild
        </Button>
        <Button
          variant="ghost"
          disabled={busy || isRunning}
          title="Вернуть зависшие processing → pending (claim'ы упавшего worker). Архив и parsed не трогает."
          onClick={() => void releaseStuck()}
        >
          Вернуть зависшие
        </Button>
        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
          {status?.kind === "rebuild" ? "Rebuild" : "—"}
          {phaseLabel ? ` · ${phaseLabel}` : ""} ·{" "}
          {STATUS_LABEL[status?.status ?? "idle"] ?? status?.status}
          {elapsed && isRunning ? ` · ${elapsed}` : ""}
        </span>
        {showQueueProgress && (
          <span>
            {processed.toLocaleString()} / {total.toLocaleString()} ({percent.toFixed(1)}%)
          </span>
        )}
        {showQueueProgress && (
          <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
            ok {status.ok.toLocaleString()} · fail {status.failed.toLocaleString()}
          </span>
        )}
      </div>

      {notice && (
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>{notice}</p>
      )}

      {status?.detail && (
        <p style={{ fontSize: 12, color: "var(--text)", marginTop: 8 }}>
          {status.detail}
        </p>
      )}

      {showQueueProgress && (
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

      {status?.logTail && (
        <pre
          style={{
            marginTop: 8,
            maxHeight: 140,
            overflow: "auto",
            padding: 8,
            fontSize: 11,
            lineHeight: 1.35,
            background: "var(--surface-2)",
            borderRadius: 4,
            whiteSpace: "pre-wrap",
            color: "var(--text-muted)",
          }}
        >
          {status.logTail}
        </pre>
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
