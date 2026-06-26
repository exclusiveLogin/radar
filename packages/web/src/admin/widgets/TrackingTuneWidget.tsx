import { useEffect, useState } from "react";

import { Button, Panel } from "../../shared/ds";

import { adminApi } from "../../shared/api/adminApi";

import { reportAppError } from "../../shared/state/appLogStore";

import type { TrackingTuneRun } from "@radar/shared";



function statusHint(run: TrackingTuneRun): string | null {

  if (run.status === "running" && run.epochsDone === 0) {

    return "Ожидание worker (TrackingTuneDaemon). Нужен stack dev с worker.";

  }

  if (run.status === "failed" && run.error) return run.error;

  if (run.status === "cancelled" && run.epochsDone === 0) {

    return "Отменён до старта или worker не был запущен.";

  }

  return null;

}



/** Виджет авто-тюнинга tracking: jobs, fitness, Apply, удаление. */

export function TrackingTuneWidget() {

  const [runs, setRuns] = useState<TrackingTuneRun[]>([]);

  const [busy, setBusy] = useState(false);



  const reload = async () => {

    try {

      setRuns(await adminApi.trackingListTune(10));

    } catch (e) {

      reportAppError("Tune", e);

    }

  };



  useEffect(() => {

    void reload();

  }, []);



  const hasRunning = runs.some(r => r.status === "running");



  useEffect(() => {

    if (!hasRunning) return;

    const timer = setInterval(() => void reload(), 3000);

    return () => clearInterval(timer);

  }, [hasRunning]);



  const run = async (action: () => Promise<unknown>) => {

    setBusy(true);

    try {

      await action();

      await reload();

    } catch (e) {

      reportAppError("Tune", e);

    } finally {

      setBusy(false);

    }

  };



  return (

    <Panel title="Auto-tune tracking">

      <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 8px" }}>

        Tune выполняет worker (TrackingTuneDaemon). API только ставит job в БД.

      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>

        <Button disabled={busy} onClick={() => void run(() => adminApi.trackingStartTune({}))}>

          Запустить tune

        </Button>

        <Button variant="ghost" disabled={busy} onClick={() => void reload()}>

          Обновить

        </Button>

      </div>

      <div style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 6 }}>

        {runs.length === 0 && <span style={{ color: "var(--text-muted)" }}>Нет tune jobs</span>}

        {runs.map(r => {

          const hint = statusHint(r);

          return (

            <div

              key={r.id}

              style={{

                border: "1px solid var(--surface-2)",

                borderRadius: 6,

                padding: 8,

                display: "grid",

                gap: 4,

              }}

            >

              <strong>

                {r.status} · эпох {r.epochsDone}/{r.maxEpochs}

              </strong>

              <span>fitness: {r.bestFitness?.toFixed(3) ?? "—"}</span>

              {hint && <span style={{ color: "var(--warning, #c9a227)" }}>{hint}</span>}

              <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{r.id}</span>

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>

                {r.status === "running" && (

                  <Button

                    variant="ghost"

                    disabled={busy}

                    onClick={() => void run(() => adminApi.trackingCancelTune(r.id))}

                  >

                    Cancel

                  </Button>

                )}

                <Button

                  variant="ghost"

                  disabled={busy}

                  onClick={() => void run(() => adminApi.trackingRestartTune(r.id))}

                >

                  Restart

                </Button>

                {r.bestConfig && (

                  <Button

                    disabled={busy}

                    onClick={() => void run(() => adminApi.trackingApplyTune(r.id))}

                  >

                    Apply

                  </Button>

                )}

                <Button

                  variant="ghost"

                  disabled={busy}

                  onClick={() => void run(() => adminApi.trackingDeleteTune(r.id))}

                >

                  Удалить

                </Button>

              </div>

            </div>

          );

        })}

      </div>

    </Panel>

  );

}

