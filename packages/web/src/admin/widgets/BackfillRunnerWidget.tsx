import { useMemo, useState } from "react";
import type { BackfillJobListItem, BackfillStrategy, CreateBackfillJob } from "@radar/shared";
import { Button, Field, Panel, Select } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import {
  backfillJobs$,
  channels$,
  refreshBackfill,
  telemetry$,
} from "../../shared/state/adminStore";
import { adminApi } from "../../shared/api/adminApi";
import { reportAppError } from "../../shared/state/appLogStore";
import { formatAge } from "../../shared/state/derivations";
import { BackfillChannelList } from "./BackfillChannelList";
import { BackfillJobCard } from "./BackfillJobCard";

const STRATEGY_OPTIONS = [
  { value: "full_history", label: "Вся история" },
  { value: "by_date_range", label: "По диапазону дат" },
  { value: "by_external_id_range", label: "По диапазону id" },
];

const ACTIVE_STATUSES = new Set(["pending", "running"]);

function toIso(local: string): string | undefined {
  if (!local) return undefined;
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function buildJobParams(
  strategy: BackfillStrategy,
  fromDate: string,
  toDate: string,
  fromId: string,
  toId: string,
  batchSize: string,
): CreateBackfillJob["params"] {
  return {
    fromPostedAt: strategy === "by_date_range" ? toIso(fromDate) : undefined,
    toPostedAt: strategy === "by_date_range" ? toIso(toDate) : undefined,
    fromExternalId: strategy === "by_external_id_range" ? fromId || undefined : undefined,
    toExternalId: strategy === "by_external_id_range" ? toId || undefined : undefined,
    batchSize: Number(batchSize) || 200,
  };
}

function sortJobs(jobs: BackfillJobListItem[], activeOnly: boolean): BackfillJobListItem[] {
  const filtered = activeOnly
    ? jobs.filter((j) => ACTIVE_STATUSES.has(j.status))
    : jobs;

  const rank = (s: string) => {
    if (s === "running") return 0;
    if (s === "pending") return 1;
    return 2;
  };

  return [...filtered].sort((a, b) => {
    const dr = rank(a.status) - rank(b.status);
    if (dr !== 0) return dr;
    return (a.channelKey ?? a.id).localeCompare(b.channelKey ?? b.id);
  });
}

/**
 * Backfill V2: форма стратегии, запуск по каналу / all-bindings, грид jobs с ~% progress.
 * Ingest (raw) отделён от parse PE 2.0 — см. подсказки в карточке completed.
 */
export function BackfillRunnerWidget() {
  const channels = useObservable(channels$, []);
  const jobs = useObservable(backfillJobs$, []);
  const telemetry = useObservable(telemetry$, null);

  const [strategy, setStrategy] = useState<BackfillStrategy>("full_history");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [batchSize, setBatchSize] = useState("200");
  const [busyBindingId, setBusyBindingId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobTab, setJobTab] = useState<"active" | "all">("active");

  const activeBindingIds = useMemo(
    () =>
      new Set(
        jobs
          .filter((j) => ACTIVE_STATUSES.has(j.status))
          .map((j) => j.bindingId),
      ),
    [jobs],
  );

  const boundChannels = useMemo(
    () => channels.filter((c) => c.bindingId),
    [channels],
  );

  const visibleJobs = useMemo(
    () => sortJobs(jobs, jobTab === "active"),
    [jobs, jobTab],
  );

  const runnableJobCount = useMemo(
    () => jobs.filter((j) => ACTIVE_STATUSES.has(j.status)).length,
    [jobs],
  );

  const workerUnreachable = telemetry != null && !telemetry.worker.reachable;
  const workerProbe = telemetry?.worker.worker;

  const createJob = async (bindingId: string): Promise<boolean> => {
    setBusyBindingId(bindingId);
    setError(null);
    try {
      await adminApi.createBackfillJob({
        bindingId,
        strategy,
        params: buildJobParams(strategy, fromDate, toDate, fromId, toId, batchSize),
      });
      await refreshBackfill();
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Не удалось создать задачу";
      setError(msg);
      reportAppError("Backfill", err, msg);
      return false;
    } finally {
      setBusyBindingId(null);
    }
  };

  const launchAll = async (): Promise<void> => {
    const targets = boundChannels.filter(
      (c) => c.bindingId && !activeBindingIds.has(c.bindingId),
    );
    if (targets.length === 0) {
      setError("Нет каналов для постановки (все уже в очереди или без binding).");
      return;
    }
    if (
      !window.confirm(
        `Создать ${targets.length} задач? Демон выполняет по одной (stream, 1 сообщение).`,
      )
    ) {
      return;
    }

    setBulkBusy(true);
    setError(null);
    let created = 0;
    const skipped = boundChannels.length - targets.length;

    try {
      for (const ch of targets) {
        const ok = await createJob(ch.bindingId!);
        if (ok) created += 1;
      }
      if (created > 0) {
        setError(null);
      }
      if (skipped > 0 && created === 0) {
        setError(`Пропущено ${skipped} (активная job на binding).`);
      }
    } finally {
      setBulkBusy(false);
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
    <Panel title="Backfill V2">
      <p className="ds-muted" style={{ fontSize: 10, margin: "0 0 8px" }}>
        Ingest-job (raw в БД). Старт с <strong>последнего</strong> сообщения канала → в архив; дубликаты
        идемпотентны. Parse PE 2.0 — Обогащение → Фазы.
      </p>

      {boundChannels.length === 0 && channels.length > 0 && (
        <p style={{ color: "var(--status-warn)", fontSize: 10, margin: "0 0 8px" }}>
          Каналы в БД есть ({channels.length}), но нет строк в ingest_bindings — нужен manifest:import
          или POST binding к провайдеру.
        </p>
      )}

      {workerUnreachable && (
        <p style={{ color: "var(--status-warn)", fontSize: 10, margin: "0 0 8px" }}>
          Worker недоступен — задачи останутся pending.
        </p>
      )}

      {runnableJobCount > 0 && workerProbe && (
        <p
          style={{
            fontSize: 10,
            margin: "0 0 8px",
            color: workerProbe.status === "running" ? "var(--status-ok)" : "var(--status-warn)",
          }}
        >
          Worker pid {workerProbe.pid} · heartbeat {formatAge(workerProbe.heartbeatAt)}
          {workerProbe.ingest.backfillInserted > 0
            ? ` · BF insert +${workerProbe.ingest.backfillInserted}`
            : " · BF: только дубли (insert=0)"}
        </p>
      )}

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
            <input className="ds-input" value={fromId} onChange={(e) => setFromId(e.target.value)} />
          </Field>
          <Field label="По id">
            <input className="ds-input" value={toId} onChange={(e) => setToId(e.target.value)} />
          </Field>
        </div>
      )}

      <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button variant="primary" onClick={() => void launchAll()} disabled={bulkBusy || boundChannels.length === 0}>
          {bulkBusy ? "Постановка…" : `Все каналы (${boundChannels.length})`}
        </Button>
      </div>

      {error && (
        <p className="ds-muted" style={{ color: "var(--status-error)", marginTop: 6 }}>
          {error}
        </p>
      )}

      <h4 style={{ margin: "14px 0 6px", fontSize: 11, color: "var(--text-muted)" }}>
        Каналы с binding
      </h4>
      <BackfillChannelList
        channels={channels}
        activeBindingIds={activeBindingIds}
        busyBindingId={busyBindingId}
        onLaunch={(bindingId) => void createJob(bindingId)}
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          margin: "14px 0 6px",
        }}
      >
        <h4 style={{ margin: 0, fontSize: 11, color: "var(--text-muted)", flex: 1 }}>
          Задачи · {visibleJobs.length}
        </h4>
        <Button
          variant={jobTab === "active" ? "primary" : "ghost"}
          onClick={() => setJobTab("active")}
        >
          Активные
        </Button>
        <Button
          variant={jobTab === "all" ? "primary" : "ghost"}
          onClick={() => setJobTab("all")}
        >
          Все
        </Button>
      </div>

      {visibleJobs.length === 0 ? (
        <p className="ds-muted">Нет задач.</p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
            gap: 8,
          }}
        >
          {visibleJobs.map((job) => (
            <BackfillJobCard
              key={job.id}
              job={job}
              runnableJobCount={runnableJobCount}
              onCancel={(id) => void cancel(id)}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}
