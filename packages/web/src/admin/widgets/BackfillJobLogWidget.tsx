import type { ParseAttemptItem } from "@radar/shared";
import { useLayoutEffect, useRef } from "react";
import { Panel } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import { parseLog$ } from "../../shared/state/adminStore";
import { formatTime } from "../format";

/** Высота скролл-области лога (~25 строк таблицы). */
const LOG_SCROLL_MAX_HEIGHT = 360;

const STATUS_LABEL: Record<ParseAttemptItem["status"], string> = {
  ok: "событие",
  failed: "ошибка",
  skipped: "пропуск",
};

function outcomeText(row: ParseAttemptItem): string {
  if (row.outcomeLabel) return row.outcomeLabel;
  if (row.status === "ok") return "—";
  const reason = row.errors?.reason;
  return typeof reason === "string" ? reason : "—";
}

/** Лог парсинга: все каналы (не фильтруется picker'ом). Parse только на insert, не на dup. */
export function BackfillJobLogWidget() {
  const log = useObservable(parseLog$, []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollSnapshotRef = useRef({ height: 0, top: 0 });

  // Новые строки приходят сверху (WS). Если пользователь листал историю — не прыгаем.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const prev = scrollSnapshotRef.current;
    const heightDelta = el.scrollHeight - prev.height;
    if (heightDelta > 0 && prev.top > 0) {
      el.scrollTop = prev.top + heightDelta;
    }

    scrollSnapshotRef.current = { height: el.scrollHeight, top: el.scrollTop };
  }, [log]);

  return (
    <Panel title="Лог парсинга (PE workspace)">
      <p className="ds-muted" style={{ fontSize: 10, margin: "0 0 8px" }}>
        Только новые raw (insert) → parse. Dedup backfill (dup) в лог не попадает.
      </p>
      {log.length === 0 ? (
        <p className="ds-muted">Нет записей парсинга.</p>
      ) : (
        <div
          ref={scrollRef}
          style={{
            maxHeight: LOG_SCROLL_MAX_HEIGHT,
            overflowY: "auto",
            overflowX: "auto",
            overflowAnchor: "none",
            border: "1px solid var(--border-subtle)",
            borderRadius: 4,
          }}
        >
          <table
            className="ds-table"
            style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}
          >
            <thead>
              <tr
                style={{
                  color: "var(--text-muted)",
                  textAlign: "left",
                  position: "sticky",
                  top: 0,
                  background: "var(--surface-raised)",
                  zIndex: 1,
                }}
              >
                <th style={{ padding: "4px 8px", width: 52 }}>Время</th>
                <th style={{ padding: "4px 8px", width: 72 }}>Статус</th>
                <th style={{ padding: "4px 8px", width: 110 }}>Канал</th>
                <th style={{ padding: "4px 8px", width: 120 }}>Тип</th>
                <th style={{ padding: "4px 8px" }}>Сообщение</th>
              </tr>
            </thead>
            <tbody>
              {log.map((row) => (
                <tr key={row.id} style={{ borderTop: "1px solid var(--border-subtle)" }}>
                  <td style={{ padding: "6px 8px", whiteSpace: "nowrap", verticalAlign: "top" }}>
                    {formatTime(row.createdAt)}
                  </td>
                  <td style={{ padding: "6px 8px", verticalAlign: "top" }}>
                    <span className={`ds-log-list__status ds-log-list__status--${row.status}`}>
                      {STATUS_LABEL[row.status]}
                    </span>
                  </td>
                  <td
                    style={{ padding: "6px 8px", verticalAlign: "top" }}
                    title={row.channelKey ?? undefined}
                  >
                    {row.channelKey ?? "—"}
                  </td>
                  <td
                    style={{
                      padding: "6px 8px",
                      verticalAlign: "top",
                      color: "var(--text-muted)",
                      wordBreak: "break-word",
                    }}
                    title={outcomeText(row)}
                  >
                    {outcomeText(row)}
                  </td>
                  <td
                    style={{
                      padding: "6px 8px",
                      verticalAlign: "top",
                      lineHeight: 1.35,
                      wordBreak: "break-word",
                    }}
                    title={row.messagePreview ?? undefined}
                  >
                    {row.externalMessageId && (
                      <span style={{ color: "var(--text-muted)", marginRight: 6 }}>
                        #{row.externalMessageId}
                      </span>
                    )}
                    {row.messagePreview?.trim() || (
                      <span style={{ color: "var(--text-muted)" }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
