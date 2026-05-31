import { useMemo } from "react";
import { Panel } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import { parseLog$ } from "../../shared/state/adminStore";
import { selectedChannelKey$ } from "../../shared/state/channelSelectionStore";
import { formatTime } from "../format";

/** Лог парсинга (parse_attempts) для выбранного канала; realtime через admin-WS. */
export function BackfillJobLogWidget() {
  const log = useObservable(parseLog$, []);
  const selected = useObservable(selectedChannelKey$, null);

  const visible = useMemo(
    () => (selected ? log.filter((row) => row.channelKey === selected) : log),
    [log, selected],
  );

  return (
    <Panel title={`Лог парсинга ${selected ? `· ${selected}` : "(все)"}`}>
      {visible.length === 0 ? (
        <p className="ds-muted">Нет записей парсинга.</p>
      ) : (
        <ul className="ds-log-list">
          {visible.map((row) => (
            <li key={row.id} className="ds-log-list__item">
              <span className={`ds-log-list__status ds-log-list__status--${row.status}`}>
                {row.status}
              </span>
              <span className="ds-log-list__text" title={row.channelKey ?? undefined}>
                {row.channelKey ?? "—"}
                {row.errors ? ` · ${JSON.stringify(row.errors)}` : ""}
              </span>
              <span className="ds-log-list__time">{formatTime(row.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
