import { useMemo, type ReactNode } from "react";
import type { MessageFeedItem } from "@radar/shared";
import { Badge, EllipsisText, Panel, Tip, flattenText } from "../../shared/ds";
import { EventTraitIcons } from "../../shared/components/EventTraitIcons";
import { useObservable } from "../../shared/hooks/useObservable";
import { formatMessagePostedAt } from "../../shared/state/derivations";
import { messagesFeed$ } from "../../shared/state/messagesStore";
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
    `content: ${row.contentKind}`,
    `parsed: ${row.parsedEventCount}`,
    `loc: ${row.hasLocations ? "да" : "нет"}`,
  ];
  if (row.eventType) parts.push(`тип: ${row.eventType}`);
  if (row.regionCodes.length > 0) {
    parts.push(`регионы: ${[...new Set(row.regionCodes)].join(", ")}`);
  }
  return parts.join("\n\n");
}

/** Бейдж статуса raw: шум / meta / без parse / тип (в т.ч. clear без loc) / loc. */
function messageStatusBadge(row: MessageFeedItem): ReactNode {
  if (row.contentKind === "noise") {
    return (
      <Tip label="Шум канала (groom/noise)">
        <span className="ds-message-feed__pending">шум</span>
      </Tip>
    );
  }
  if (row.contentKind === "meta") {
    return (
      <Tip label="Meta / сводка — не оперативное событие">
        <span className="ds-message-feed__pending">meta</span>
      </Tip>
    );
  }
  if (row.parsedEventCount === 0) {
    return (
      <Tip label="Не разобрано или отфильтровано на groom">
        <span className="ds-message-feed__pending">raw</span>
      </Tip>
    );
  }
  if (row.stateLevel) {
    return (
      <Tip
        label={[
          row.eventType ? `тип: ${row.eventType}` : null,
          row.hasLocations ? "есть loc" : "без loc (канальный/массовый отбой)",
        ]
          .filter(Boolean)
          .join(" · ")}
      >
        <Badge level={row.stateLevel} />
      </Tip>
    );
  }
  if (row.eventType) {
    return (
      <Tip
        label={
          row.hasLocations
            ? `Тип: ${row.eventType}`
            : `Разобрано без loc: ${row.eventType}`
        }
      >
        <span className="ds-message-feed__pending">{row.eventType}</span>
      </Tip>
    );
  }
  if (!row.hasLocations) {
    return (
      <Tip label="Parse без event_locations и без event_type">
        <span className="ds-message-feed__pending">parse</span>
      </Tip>
    );
  }
  return (
    <Tip label="Есть loc, тип не определён">
      <span className="ds-message-feed__pending">loc</span>
    </Tip>
  );
}

/** Лента ingest: все raw, независимо от parse/loc. */
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
                  {messageStatusBadge(row)}
                  <EventTraitIcons
                    repeat={row.repeat}
                    uncertain={row.uncertain}
                    multiple={row.multiple}
                    mass={row.mass}
                  />
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
