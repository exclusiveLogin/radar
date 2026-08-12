import { useMemo, type ReactNode } from "react";
import type { MessageFeedItem, StateLevel } from "@radar/shared";
import { resolveThreatVisual } from "@radar/shared";
import { flattenText, Panel, Tip } from "../../shared/ds";
import { ThreatIcon } from "../../shared/ds/ThreatIcon";
import { EventCardHead } from "../../shared/components/EventCardHead";
import { EventTraitIcons } from "../../shared/components/EventTraitIcons";
import { RegionCodeChips } from "../../shared/components/RegionCodeChips";
import { useObservable } from "../../shared/hooks/useObservable";
import { formatMessagePostedAt } from "../../shared/state/derivations";
import { formatDateTime, formatTimeShort } from "../../shared/format/dateTime";
import { messagesFeed$ } from "../../shared/state/messagesStore";
import { setHistoricalAsOf } from "../../shared/state/mapStore";
import { selectRegion, selectedRegion$ } from "../../shared/state/selectionStore";
import { statusTitle } from "../../shared/state/statusDictionaryStore";
import type { WidgetProps } from "../widgetProps";

function sourceLabel(row: MessageFeedItem): string {
  return row.channelTitle?.trim() || row.channelKey;
}

function messageTip(row: MessageFeedItem): string {
  const parts = [
    sourceLabel(row),
    formatDateTime(row.postedAt),
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

type MessageHeadModel = {
  level?: StateLevel;
  reason?: string;
  reasonColor?: string;
  icon?: ReactNode;
  tip?: string;
};

/** Поля шапки: уровень/причина или pending-метка (шум/meta/raw…). */
function messageHeadModel(row: MessageFeedItem): MessageHeadModel {
  if (row.contentKind === "noise") {
    return { reason: "шум", tip: "Шум канала (groom/noise)" };
  }
  if (row.contentKind === "meta") {
    return { reason: "meta", tip: "Meta / сводка — не оперативное событие" };
  }
  if (row.parsedEventCount === 0) {
    return { reason: "raw", tip: "Не разобрано или отфильтровано на groom" };
  }

  const eventType = row.eventType ?? undefined;
  if (row.stateLevel) {
    const visual = resolveThreatVisual({
      statusCode: eventType,
      traits: { mass: row.mass, uncertain: row.uncertain },
    });
    return {
      level: row.stateLevel,
      reason: eventType ? statusTitle(eventType) : undefined,
      reasonColor: visual?.accentColor,
      tip: row.hasLocations ? "есть loc" : "без loc (канальный/массовый отбой)",
      icon: (
        <ThreatIcon
          compact
          statusCode={eventType}
          traits={{ mass: row.mass, uncertain: row.uncertain }}
          title={eventType ? statusTitle(eventType) : undefined}
        />
      ),
    };
  }
  if (eventType) {
    return {
      reason: statusTitle(eventType),
      tip: row.hasLocations ? "Разобрано с loc" : `Разобрано без loc: ${eventType}`,
    };
  }
  if (!row.hasLocations) {
    return { reason: "parse", tip: "Parse без event_locations и без event_type" };
  }
  return { reason: "loc", tip: "Есть loc, тип не определён" };
}

/** Лента ingest: все raw, независимо от parse/loc. */
export function MessagesFeedWidget({
  defaultCollapsed = false,
  panelPersistenceKey,
}: WidgetProps) {
  const messages = useObservable(messagesFeed$, []);
  const selected = useObservable(selectedRegion$, null);

  const visible = useMemo(() => {
    if (!selected) return messages;
    return messages.filter((row) => row.regionCodes.includes(selected));
  }, [messages, selected]);

  const filterAction = selected ? (
    <button
      type="button"
      className="ds-event-card__action"
      style={{ marginTop: 0, padding: "2px 8px" }}
      onClick={() => selectRegion(null)}
    >
      Сбросить: {selected}
    </button>
  ) : null;

  return (
    <Panel
      title="Сообщения"
      actions={filterAction}
      variant="glass"
      collapsible
      defaultCollapsed={defaultCollapsed}
      persistenceKey={panelPersistenceKey}
    >
      {visible.length === 0 ? (
        <p className="ds-muted">Нет сообщений или API недоступен.</p>
      ) : (
        <ul className="ds-message-feed">
          {visible.map((row) => {
            const head = messageHeadModel(row);
            const regionCodes = [...new Set(row.regionCodes)];
            const text = flattenText(row.rawText);

            return (
              <li key={row.id} className="ds-message-feed__item">
                <EventCardHead
                  title={sourceLabel(row)}
                  level={head.level}
                  icon={head.icon}
                  reason={head.reason}
                  reasonColor={head.reasonColor}
                  traits={
                    <EventTraitIcons
                      repeat={row.repeat}
                      uncertain={row.uncertain}
                      multiple={row.multiple}
                      mass={row.mass}
                    />
                  }
                  time={formatTimeShort(row.postedAt)}
                  timeAction={
                    <button
                      type="button"
                      className="map-timeline__jump"
                      title="Карта на момент события"
                      aria-label="Карта на момент события"
                      onClick={() => void setHistoricalAsOf(row.postedAt)}
                    >
                      ⏱
                    </button>
                  }
                  meta={
                    regionCodes.length > 0 ? (
                      <RegionCodeChips codes={regionCodes} inline />
                    ) : undefined
                  }
                >
                  <Tip label={messageTip(row)} className="ds-tip--hint">
                    <p className="ds-message-feed__text" title={head.tip}>
                      {text}
                    </p>
                  </Tip>
                </EventCardHead>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
