import { useEffect, useState } from "react";
import type { TrackingRebuildRun } from "@radar/shared";
import { Panel } from "../../shared/ds";
import { adminApi } from "../../shared/api/adminApi";
import { reportAppError } from "../../shared/state/appLogStore";
import { formatDateTime } from "../format";

/** История rebuild runs. */
export function TrackingRunHistoryWidget() {
  const [runs, setRuns] = useState<TrackingRebuildRun[]>([]);

  useEffect(() => {
    void adminApi
      .trackingGetRuns(30)
      .then(setRuns)
      .catch(e => reportAppError("История треков", e));
  }, []);

  return (
    <Panel title="История runs">
      <table className="ds-table" style={{ width: "100%", fontSize: 12 }}>
        <thead>
          <tr>
            <th>Старт</th>
            <th>Режим</th>
            <th>Статус</th>
            <th>%</th>
          </tr>
        </thead>
        <tbody>
          {runs.map(run => (
            <tr key={run.id}>
              <td>{formatDateTime(run.startedAt)}</td>
              <td>{run.mode}</td>
              <td>{run.status}</td>
              <td>{run.stats?.percentApprox ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
