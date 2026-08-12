import { useMemo } from "react";
import type { StateChangeEventItem } from "@radar/shared";
import { resolveThreatVisual } from "@radar/shared";
import { Accordion, Panel } from "../../shared/ds";
import type { AccordionItem } from "../../shared/ds";
import { ThreatIcon } from "../../shared/ds/ThreatIcon";
import { EventCardHead } from "../../shared/components/EventCardHead";
import { RegionCodeChips } from "../../shared/components/RegionCodeChips";
import { EventTraitIcons } from "../../shared/components/EventTraitIcons";
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

function regionsTip(row: StateChangeEventItem): string {
  const names = [...new Set(row.regionNames)].filter(Boolean);
  if (names.length === 0) return row.regionCodes.join(", ");
  return names.join(" · ");
}

function primaryTitle(row: StateChangeEventItem): string {
  const names = [...new Set(row.regionNames)].filter(Boolean);
  if (names.length === 1) return names[0]!;
  if (names.length > 1) return `${names[0]} +${names.length - 1}`;
  const codes = [...new Set(row.regionCodes)].filter(Boolean);
  return codes[0] ?? sourceLabel(row);
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
    const namesLine = regionsTip(row);
    const code = reasonCode(row);
    const reason = code ? statusTitle(code, code) : undefined;
    const visual = resolveThreatVisual({
      statusCode: code,
      traits: { mass: row.mass, uncertain: row.uncertain },
    });
    const raw = row.rawText.trim();

    return {
      id: row.parsedEventId,
      headTip: [
        namesLine,
        ...regionCodes,
        sourceLabel(row),
        formatDateTime(row.postedAt),
        reason,
        raw,
      ]
        .filter(Boolean)
        .join("\n"),
      head: (
        <EventCardHead
          title={primaryTitle(row)}
          level={row.stateLevel}
          icon={
            <ThreatIcon
              compact
              statusCode={code}
              traits={{ mass: row.mass, uncertain: row.uncertain }}
              title={reason}
            />
          }
          reason={reason}
          reasonColor={visual?.accentColor}
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
              onClick={(event) => {
                event.stopPropagation();
                void setHistoricalAsOf(row.postedAt);
              }}
            >
              ⏱
            </button>
          }
          meta={
            <>
              <RegionCodeChips codes={regionCodes} inline />
              <span className="ds-event-card__meta-source">{sourceLabel(row)}</span>
            </>
          }
        />
      ),
      body: (
        <>
          <dl className="ds-event-card__facts">
            <div className="ds-event-card__fact">
              <dt>Источник</dt>
              <dd>{sourceLabel(row)}</dd>
            </div>
            <div className="ds-event-card__fact">
              <dt>Время</dt>
              <dd>{formatDateTime(row.postedAt)}</dd>
            </div>
            {namesLine && (
              <div className="ds-event-card__fact">
                <dt>Регионы</dt>
                <dd>{namesLine}</dd>
              </div>
            )}
            {reason && (
              <div className="ds-event-card__fact">
                <dt>Тип</dt>
                <dd>{reason}{code ? ` (${code})` : ""}</dd>
              </div>
            )}
          </dl>
          {raw && <pre className="ds-event-card__quote">{raw}</pre>}
        </>
      ),
    };
  });

  const filterAction = selected ? (
    <button
      type="button"
      className="ds-event-card__action"
      style={{ marginTop: 0, padding: "2px 8px" }}
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
