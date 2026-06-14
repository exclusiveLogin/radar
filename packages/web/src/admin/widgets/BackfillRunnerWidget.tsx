import { useMemo, useState } from "react";
import type { BackfillStrategy } from "@radar/shared";
import { Button, Field, Panel, Select } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import {
  backfillJobs$,
  channels$,
  refreshBackfill,
} from "../../shared/state/adminStore";
import { selectedChannelKey$ } from "../../shared/state/channelSelectionStore";
import { adminApi } from "../../shared/api/adminApi";
import { reportAppError } from "../../shared/state/appLogStore";
import { formatDateTime } from "../format";

const STRATEGY_OPTIONS = [
  { value: "full_history", label: "Вся история" },
  { value: "by_date_range", label: "По диапазону дат" },
  { value: "by_external_id_range", label: "По диапазону id" },
];

const CANCELABLE = new Set(["pending", "running"]);

/** Доля новых сообщений (insert) среди обработанных — индикатор полезности докачки. */
function insertedShare(inserted: number, duplicates: number): number {
  const total = inserted + duplicates;
  return total === 0 ? 0 : Math.round((inserted / total) * 100);
}

function toIso(local: string): string | undefined {
  if (!local) return undefined;
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Action-панель backfill: форма постановки + список задач канала с прогрессом/отменой. */
export function BackfillRunnerWidget() {
  const channels = useObservable(channels$, []);
  const jobs = useObservable(backfillJobs$, []);
  const selectedKey = useObservable(selectedChannelKey$, null);

  const [strategy, setStrategy] = useState<BackfillStrategy>("full_history");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [batchSize, setBatchSize] = useState("200");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const channel = useMemo(
    () => channels.find((c) => c.key === selectedKey) ?? null,
    [channels, selectedKey],
  );
  const bindingId = channel?.bindingId ?? null;

  const channelJobs = useMemo(
    () => (selectedKey ? jobs.filter((j) => j.channelKey === selectedKey) : jobs),
    [jobs, selectedKey],
  );

  const submit = async (): Promise<void> => {
    if (!bindingId) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.createBackfillJob({
        bindingId,
        strategy,
        params: {
          fromPostedAt: strategy === "by_date_range" ? toIso(fromDate) : undefined,
          toPostedAt: strategy === "by_date_range" ? toIso(toDate) : undefined,
          fromExternalId: strategy === "by_external_id_range" ? fromId || undefined : undefined,
          toExternalId: strategy === "by_external_id_range" ? toId || undefined : undefined,
          batchSize: Number(batchSize) || 200,
        },
      });
      await refreshBackfill();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Не удалось создать задачу";
      setError(msg);
      reportAppError("Backfill", err, msg);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id: string): Promise<void> => {
    try {
      await adminApi.cancelBackfillJob(id);
      await refreshBackfill();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Не удалось отменить";
      setError(msg);
      reportAppError("Backfill", err, msg);
    }
  };

  return (
    <Panel title="Backfill раннер">
      {!channel ? (
        <p className="ds-muted">Выберите канал для постановки докачки.</p>
      ) : !bindingId ? (
        <p className="ds-muted">У канала «{channel.key}» нет binding — докачка недоступна.</p>
      ) : (
        <>
          <div className="ds-form-row">
            <Field label="Стратегия">
              <Select
                value={strategy}
                options={STRATEGY_OPTIONS}
                onChange={(e) => setStrategy(e.target.value as BackfillStrategy)}
              />
            </Field>
            <Field label="Batch size">
              <input
                className="ds-input"
                type="number"
                min={1}
                value={batchSize}
                onChange={(e) => setBatchSize(e.target.value)}
              />
            </Field>
          </div>

          {strategy === "by_date_range" && (
            <div className="ds-form-row" style={{ marginTop: 8 }}>
              <Field label="С даты">
                <input
                  className="ds-input"
                  type="datetime-local"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                />
              </Field>
              <Field label="По дату">
                <input
                  className="ds-input"
                  type="datetime-local"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                />
              </Field>
            </div>
          )}

          {strategy === "by_external_id_range" && (
            <div className="ds-form-row" style={{ marginTop: 8 }}>
              <Field label="С id">
                <input
                  className="ds-input"
                  value={fromId}
                  onChange={(e) => setFromId(e.target.value)}
                />
              </Field>
              <Field label="По id">
                <input
                  className="ds-input"
                  value={toId}
                  onChange={(e) => setToId(e.target.value)}
                />
              </Field>
            </div>
          )}

          <div style={{ marginTop: 10 }}>
            <Button variant="primary" onClick={() => void submit()} disabled={busy}>
              {busy ? "Постановка…" : "Запустить докачку"}
            </Button>
          </div>
          {error && (
            <p className="ds-muted" style={{ color: "var(--status-error)", marginTop: 6 }}>
              {error}
            </p>
          )}
        </>
      )}

      <h4 style={{ margin: "12px 0 6px", fontSize: 11, color: "var(--text-muted)" }}>
        Задачи {selectedKey ? `канала ${selectedKey}` : "(все)"} · {channelJobs.length}
      </h4>
      {channelJobs.length === 0 ? (
        <p className="ds-muted">Нет задач.</p>
      ) : (
        <ul className="ds-log-list">
          {channelJobs.map((job) => (
            <li
              key={job.id}
              className="ds-log-list__item"
              style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ flex: 1, fontWeight: 600 }}>{job.strategy}</span>
                <span style={{ color: "var(--text-muted)" }}>{job.status}</span>
                {CANCELABLE.has(job.status) && (
                  <Button variant="danger" onClick={() => void cancel(job.id)}>
                    Отменить
                  </Button>
                )}
              </div>
              <div className="ds-progress">
                <div
                  className="ds-progress__fill"
                  style={{ width: `${insertedShare(job.progress.inserted, job.progress.duplicates)}%` }}
                />
              </div>
              <div style={{ display: "flex", gap: 10, color: "var(--text-muted)", fontSize: 10 }}>
                <span>insert {job.progress.inserted}</span>
                <span>dup {job.progress.duplicates}</span>
                <span title={formatDateTime(job.progress.checkpointPostedAt)}>
                  cp {job.progress.checkpointOffsetId ?? "—"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
