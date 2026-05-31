import { useMemo } from "react";
import { Panel } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import { parseLog$ } from "../../shared/state/adminStore";
import { formatTime } from "../format";

/** Последние ошибки парсинга (status=failed) с текстом errors. */
export function ParseErrorsWidget() {
  const log = useObservable(parseLog$, []);
  const failed = useMemo(() => log.filter((row) => row.status === "failed"), [log]);

  return (
    <Panel title={`Ошибки парсинга (${failed.length})`}>
      {failed.length === 0 ? (
        <p className="ds-muted">Ошибок не зафиксировано.</p>
      ) : (
        <ul className="ds-log-list">
          {failed.map((row) => (
            <li key={row.id} className="ds-log-list__item">
              <span className="ds-log-list__status ds-log-list__status--failed">err</span>
              <span className="ds-log-list__text" title={JSON.stringify(row.errors)}>
                {row.channelKey ?? "—"} · {row.errors ? JSON.stringify(row.errors) : "—"}
              </span>
              <span className="ds-log-list__time">{formatTime(row.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
