import { useCallback, useEffect, useState } from "react";
import type { JobDefinition, JobRun, JobType } from "@radar/shared";
import { Button, Field, Panel, Select } from "../../shared/ds";
import { adminApi } from "../../shared/api/adminApi";
import { formatDateTime } from "../format";

const TYPE_OPTIONS: { value: JobType; label: string }[] = [
  { value: "enrich-llm", label: "Обогащение · LLM" },
  { value: "enrich-dadata", label: "Обогащение · Dadata" },
  { value: "enrich-nominatim", label: "Обогащение · Nominatim" },
  { value: "reparse", label: "Reparse (полный)" },
];

const RUN_STATUS_COLOR: Record<string, string> = {
  completed: "var(--status-ok)",
  running: "var(--status-warn)",
  failed: "var(--status-error)",
  canceled: "var(--text-muted)",
  pending: "var(--text-muted)",
};

const POLL_MS = 10_000;

/**
 * Планировщик задач (ADR-003, Фаза G): создание/тумблер/триггер определений и
 * лента последних запусков. Прогресс — через REST-поллинг job_runs.
 */
export function JobsWidget() {
  const [definitions, setDefinitions] = useState<JobDefinition[]>([]);
  const [runs, setRuns] = useState<JobRun[]>([]);
  const [type, setType] = useState<JobType>("enrich-llm");
  const [cron, setCron] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [defs, recentRuns] = await Promise.all([
        adminApi.jobDefinitions(),
        adminApi.jobRuns({ limit: 20 }),
      ]);
      setDefinitions(defs);
      setRuns(recentRuns);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить задачи");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const createDefinition = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await adminApi.createJobDefinition({
        type,
        cron: cron.trim() || null,
        params: {},
        enabled: true,
        priority: 0,
      });
      setCron("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать определение");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (def: JobDefinition): Promise<void> => {
    try {
      await adminApi.updateJobDefinition(def.id, { enabled: !def.enabled });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось переключить");
    }
  };

  const trigger = async (def: JobDefinition): Promise<void> => {
    try {
      await adminApi.triggerJob(def.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось запустить");
    }
  };

  return (
    <Panel title="Планировщик задач">
      <div className="ds-form-row">
        <Field label="Тип задачи">
          <Select
            value={type}
            options={TYPE_OPTIONS}
            onChange={(e) => setType(e.target.value as JobType)}
          />
        </Field>
        <Field label="Cron (пусто = вручную)">
          <input
            className="ds-input"
            placeholder="*/15 * * * *"
            value={cron}
            onChange={(e) => setCron(e.target.value)}
          />
        </Field>
      </div>
      <div style={{ marginTop: 10 }}>
        <Button variant="primary" onClick={() => void createDefinition()} disabled={busy}>
          {busy ? "Создание…" : "Добавить определение"}
        </Button>
      </div>
      {error && (
        <p className="ds-muted" style={{ color: "var(--status-error)", marginTop: 6 }}>
          {error}
        </p>
      )}

      <h4 style={{ margin: "12px 0 6px", fontSize: 11, color: "var(--text-muted)" }}>
        Определения · {definitions.length}
      </h4>
      {definitions.length === 0 ? (
        <p className="ds-muted">Нет определений.</p>
      ) : (
        <ul className="ds-log-list">
          {definitions.map((def) => (
            <li key={def.id} className="ds-log-list__item" style={{ alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1, fontWeight: 600 }}>{def.type}</span>
              <span style={{ color: "var(--text-muted)", fontSize: 10 }}>{def.cron ?? "вручную"}</span>
              <Button variant="ghost" onClick={() => void toggle(def)}>
                {def.enabled ? "вкл" : "выкл"}
              </Button>
              <Button variant="primary" onClick={() => void trigger(def)}>
                Запустить
              </Button>
            </li>
          ))}
        </ul>
      )}

      <h4 style={{ margin: "12px 0 6px", fontSize: 11, color: "var(--text-muted)" }}>
        Запуски · {runs.length}
      </h4>
      {runs.length === 0 ? (
        <p className="ds-muted">Нет запусков.</p>
      ) : (
        <ul className="ds-log-list">
          {runs.map((run) => (
            <li key={run.id} className="ds-log-list__item" style={{ alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1 }}>{run.type}</span>
              <span style={{ color: RUN_STATUS_COLOR[run.status] ?? "var(--text-muted)" }}>
                {run.status}
              </span>
              <span style={{ color: "var(--text-muted)", fontSize: 10 }}>
                {formatDateTime(run.startedAt ?? run.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
