import { useMemo } from "react";
import type { MessageFeedItem } from "@radar/shared";
import { Badge, EllipsisText, Panel, Tip, flattenText } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import { formatMessagePostedAt } from "../../shared/state/derivations";
import { messagesFeed$ } from "../../shared/state/stateChangesFeedStore";
import { setHistoricalAsOf } from "../../shared/state/mapStore";
import { selectRegion, selectedRegion$ } from "../../shared/state/selectionStore";
import type { WidgetProps } from "../widgetProps";

function sourceLabel(row: MessageFeedItem): string {
  return row.channelTitle?.trim() || row.channelKey;
}

function formatPostedAtFull(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Europe/Moscow",
  });
}

function messageTip(row: MessageFeedItem): string {
  const parts = [
    sourceLabel(row),
    formatPostedAtFull(row.postedAt),
    row.rawText.trim(),
  ];
  if (row.eventType) parts.push(`parse: ${row.eventType}`);
  if (row.regionCodes.length > 0) {
    parts.push(`регионы: ${[...new Set(row.regionCodes)].join(", ")}`);
  }
  return parts.join("\n\n");
}

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
          {visible.map((row) => {
            const regionsLabel = [...new Set(row.regionCodes)].join(" · ");
            return (
              <li key={row.id} className="ds-message-feed__item">
                <div className="ds-message-feed__meta">
                  <EllipsisText
                    text={sourceLabel(row)}
                    className="ds-message-feed__source ds-ellipsis"
                    tip={sourceLabel(row)}
                  />
                  <Tip label={formatPostedAtFull(row.postedAt)}>
                    <span className="ds-message-feed__time">
                      {formatMessagePostedAt(row.postedAt)}
                    </span>
                  </Tip>
                  <button
                    type="button"
                    className="map-timeline__jump"
                    title="Карта на момент события"
                    aria-label="Карта на момент события"
                    onClick={() => void setHistoricalAsOf(row.postedAt)}
                  >
                    ⏱
                  </button>
                  {row.stateLevel ? (
                    <Badge level={row.stateLevel} />
                  ) : row.eventType ? (
                    <Tip label={`Тип события: ${row.eventType}`}>
                      <span className="ds-message-feed__pending">parse</span>
                    </Tip>
                  ) : (
                    <Tip label="Сообщение без parse — только raw">
                      <span className="ds-message-feed__pending">raw</span>
                    </Tip>
                  )}
                  {row.repeat && (
                    <Tip label="Повторное сообщение">
                      <span className="ds-message-feed__repeat">↻</span>
                    </Tip>
                  )}
                </div>
                <Tip label={messageTip(row)} className="ds-tip--hint">
                  <p className="ds-message-feed__text">{flattenText(row.rawText)}</p>
                </Tip>
                {regionsLabel && (
                  <EllipsisText
                    text={regionsLabel}
                    className="ds-message-feed__regions ds-ellipsis"
                    tip={regionsLabel}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
