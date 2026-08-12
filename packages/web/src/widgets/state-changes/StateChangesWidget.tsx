import { useMemo } from "react";
import type { StateChangeEventItem } from "@radar/shared";
import { resolveThreatVisual } from "@radar/shared";
import { Accordion, Badge, Panel } from "../../shared/ds";
import type { AccordionItem } from "../../shared/ds";
import { ThreatIcon } from "../../shared/ds/ThreatIcon";
import { RegionCodeChips } from "../../shared/components/RegionCodeChips";
import { EventTraitIcons } from "../../shared/components/EventTraitIcons";
import { StatusReasonChip } from "../../shared/components/StatusReasonChip";
import { formatDateTime, formatTimeShort } from "../../shared/format/dateTime";
import { useObservable } from "../../shared/hooks/useObservable";
import { setHistoricalAsOf } from "../../shared/state/mapStore";
import { stateChangesFeed$ } from "../../shared/state/stateChangesFeedStore";
import { selectRegion, selectedRegion$ } from "../../shared/state/selectionStore";
import { statusTitle } from "../../shared/state/statusDictionaryStore";
import type { WidgetProps } from "../widgetProps";

function sourceLabel(row: StateChangeEventItem): string {
  return row.channelTitle?.trim() || row.channelKey;
}

/** Код причины события: приоритет у eventType (совпадает со status_dictionary), иначе LLM-категория. */
function reasonCode(row: StateChangeEventItem): string | undefined {
  return row.eventType ?? row.eventCategory ?? undefined;
}

function parseMetaLine(row: StateChangeEventItem): string | null {
  const parts = [
    row.eventType ? `тип: ${row.eventType}` : null,
    row.eventCategory ? `категория: ${row.eventCategory}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function regionsTip(row: StateChangeEventItem): string {
  const names = [...new Set(row.regionNames)].filter(Boolean);
  if (names.length === 0) return row.regionCodes.join(", ");
  return names.join(" · ");
}

/**
 * Лента изменений: 1 parsed_event = 1 карточка, регионы видны в свёрнутой строке.
 */
export function StateChangesWidget({
  defaultCollapsed = false,
  panelPersistenceKey,
}: WidgetProps) {
  const events = useObservable(stateChangesFeed$, []);
  const selected = useObservable(selectedRegion$, null);

  const visible = useMemo(() => {
    if (!selected) return events;
    return events.filter((row) => row.regionCodes.includes(selected));
  }, [events, selected]);

  const items: AccordionItem[] = visible.map((row) => {
    const regionCodes = [...new Set(row.regionCodes)];
    const parseLine = parseMetaLine(row);
    const namesLine = regionsTip(row);
    const code = reasonCode(row);
    const visual = resolveThreatVisual({ statusCode: code, traits: { mass: row.mass, uncertain: row.uncertain } });

    return {
      id: row.parsedEventId,
      headTip: [
        namesLine,
        ...regionCodes,
        sourceLabel(row),
        formatDateTime(row.postedAt),
        parseLine,
        row.rawText.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
      head: (
        <div className="ds-event-card__head">
          <div className="ds-event-card__row1">
            <Badge level={row.stateLevel} />
            <ThreatIcon
              compact
              statusCode={code}
              traits={{ mass: row.mass, uncertain: row.uncertain }}
              title={code ? statusTitle(code) : undefined}
            />
            {code && <StatusReasonChip label={statusTitle(code, code)} accentColor={visual?.accentColor} />}
            <EventTraitIcons
              repeat={row.repeat}
              uncertain={row.uncertain}
              multiple={row.multiple}
              mass={row.mass}
            />
            <span className="ds-muted ds-accordion__head-time">
              {formatTimeShort(row.postedAt)}
            </span>
            <button
              type="button"
              className="map-timeline__jump"
              title="Карта на момент события"
              aria-label="Карта на момент события"
              onClick={(event) => {
                event.stopPropagation();
                void setHistoricalAsOf(row.postedAt);
              }}
            >
              ⏱
            </button>
          </div>
          <div className="ds-event-card__row2">
            <RegionCodeChips codes={regionCodes} inline />
            <span className="ds-event-card__row2-name">{sourceLabel(row)}</span>
          </div>
        </div>
      ),
      body: (
        <>
          <div className="ds-muted" style={{ fontSize: 12 }}>
            {sourceLabel(row)} · {formatDateTime(row.postedAt)}
          </div>
          {namesLine && (
            <div className="ds-muted" style={{ fontSize: 12, marginTop: 4 }}>
              {namesLine}
            </div>
          )}
          {parseLine && (
            <div className="ds-muted" style={{ fontSize: 12, marginTop: 4 }}>
              {parseLine}
            </div>
          )}
          <pre
            style={{
              margin: "8px 0 0",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: "inherit",
              fontSize: 12,
              color: "var(--text)",
            }}
          >
            {row.rawText.trim()}
          </pre>
        </>
      ),
    };
  });

  const filterAction = selected ? (
    <button
      type="button"
      className="ds-accordion__head"
      style={{ width: "auto", padding: "2px 8px" }}
      onClick={() => selectRegion(null)}
    >
      Сбросить фильтр: {selected}
    </button>
  ) : null;

  return (
    <Panel
      title="Лента изменений"
      actions={filterAction}
      variant="glass"
      collapsible
      defaultCollapsed={defaultCollapsed}
      persistenceKey={panelPersistenceKey}
    >
      {items.length === 0 ? (
        <p className="ds-muted">Нет событий с привязкой к регионам на карте.</p>
      ) : (
        <Accordion items={items} />
      )}
    </Panel>
  );
}
