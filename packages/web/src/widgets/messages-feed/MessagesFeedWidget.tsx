import { useMemo } from "react";
import type { MessageFeedItem } from "@radar/shared";
import { Badge, Panel } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import { formatMessagePostedAt } from "../../shared/state/derivations";
import { messagesFeed$ } from "../../shared/state/messagesStore";
import { selectRegion, selectedRegion$ } from "../../shared/state/selectionStore";

/** Однострочный preview текста без лишних переносов. */
function previewText(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

function sourceLabel(row: MessageFeedItem): string {
  return row.channelTitle?.trim() || row.channelKey;
}

import type { WidgetProps } from "../widgetProps";

/** Лента ingest-сообщений: источник, время MSK, parse/уровень. */
export function MessagesFeedWidget({ defaultCollapsed = false }: WidgetProps) {
  const messages = useObservable(messagesFeed$, []);
  const selected = useObservable(selectedRegion$, null);

  const visible = useMemo(() => {
    if (!selected) return messages;
    return messages.filter((row) => row.regionCodes.includes(selected));
  }, [messages, selected]);

  const filterAction = selected ? (
    <button
      type="button"
      className="ds-accordion__head"
      style={{ width: "auto", padding: "2px 8px" }}
      onClick={() => selectRegion(null)}
    >
      Сбросить: {selected}
    </button>
  ) : null;

  return (
    <Panel title="Сообщения" actions={filterAction} variant="glass" collapsible defaultCollapsed={defaultCollapsed}>
      {visible.length === 0 ? (
        <p className="ds-muted">Нет сообщений или API недоступен.</p>
      ) : (
        <ul className="ds-message-feed">
          {visible.map((row) => (
            <li key={row.id} className="ds-message-feed__item">
              <div className="ds-message-feed__meta">
                <span className="ds-message-feed__source">{sourceLabel(row)}</span>
                <span className="ds-message-feed__time" title={row.postedAt}>
                  {formatMessagePostedAt(row.postedAt)}
                </span>
                {row.stateLevel ? (
                  <Badge level={row.stateLevel} />
                ) : row.eventType ? (
                  <span className="ds-message-feed__pending">parse</span>
                ) : (
                  <span className="ds-message-feed__pending">raw</span>
                )}
              </div>
              <p className="ds-message-feed__text">{previewText(row.rawText)}</p>
              {row.regionCodes.length > 0 && (
                <div className="ds-message-feed__regions">
                  {[...new Set(row.regionCodes)].join(" · ")}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
