import { useMemo } from "react";
import type { MapPlaceSnapshot, MapRegionSnapshot, StateLevel } from "@radar/shared";
import { resolveThreatVisual } from "@radar/shared";
import { Accordion, Badge, Panel } from "../../shared/ds";
import type { AccordionItem } from "../../shared/ds";
import { ThreatIcon } from "../../shared/ds/ThreatIcon";
import { EventTraitIcons } from "../../shared/components/EventTraitIcons";
import { SourceMessageBlock } from "../../shared/components/SourceMessageBlock";
import { StatusReasonChip } from "../../shared/components/StatusReasonChip";
import { formatDateTime, formatTimeShort } from "../../shared/format/dateTime";
import { useBehaviorSubject } from "../../shared/hooks/useBehaviorSubject";
import { placesById$, regionsByCode$ } from "../../shared/state/mapStore";
import { selectRegion, selectedRegion$ } from "../../shared/state/selectionStore";
import { statusTitle } from "../../shared/state/statusDictionaryStore";
import type { WidgetProps } from "../widgetProps";

const LEVEL_RANK: Record<StateLevel, number> = {
  red: 5,
  orange: 4,
  yellow: 3,
  green: 2,
  grey: 0,
};

function compareRegions(a: MapRegionSnapshot, b: MapRegionSnapshot): number {
  const byLevel = LEVEL_RANK[b.stateLevel] - LEVEL_RANK[a.stateLevel];
  if (byLevel !== 0) return byLevel;
  return (b.activity ?? 0) - (a.activity ?? 0);
}

function regionStatusAt(row: MapRegionSnapshot): string | undefined {
  return row.statusEventAt;
}

function placeStatusAt(row: MapPlaceSnapshot): string {
  return row.statusEventAt ?? row.updatedAt;
}

/** Текущие активные угрозы: регионы/места из mapStore (fold snapshot + WS). */
export function ActiveThreatsWidget({
  defaultCollapsed = false,
  panelPersistenceKey,
}: WidgetProps) {
  const regions = useBehaviorSubject(regionsByCode$);
  const places = useBehaviorSubject(placesById$);
  const selected = useBehaviorSubject(selectedRegion$);

  const { regionRows, placeRows } = useMemo(() => {
    const regionRows = [...regions.values()]
      .filter((row) => row.stateLevel !== "grey")
      .filter((row) => !selected || row.regionCode === selected)
      .sort(compareRegions);

    const placeRows = [...places.values()]
      .filter((row) => row.stateLevel !== "grey")
      .filter((row) => !selected || row.regionCode === selected)
      .sort(
        (a, b) =>
          LEVEL_RANK[b.stateLevel] - LEVEL_RANK[a.stateLevel]
          || placeStatusAt(b).localeCompare(placeStatusAt(a)),
      );

    return { regionRows, placeRows };
  }, [regions, places, selected]);

  const items: AccordionItem[] = [
    ...regionRows.map((row) => {
      const visual = resolveThreatVisual({
        statusCode: row.statusCode,
        traits: row.traits,
        eventSubject: row.eventSubject,
      });
      return {
        id: `region:${row.regionCode}`,
        headTip: `${row.name}\n${row.regionCode}`,
        head: (
          <div className="ds-event-card__head">
            <div className="ds-event-card__row1">
              <Badge level={row.stateLevel} />
              <ThreatIcon
                compact
                statusCode={row.statusCode}
                traits={row.traits}
                eventSubject={row.eventSubject}
                title={statusTitle(row.statusCode)}
              />
              {row.statusCode && (
                <StatusReasonChip label={statusTitle(row.statusCode)} accentColor={visual?.accentColor} />
              )}
              <EventTraitIcons
                compact
                mass={row.traits?.mass}
                uncertain={row.traits?.uncertain}
              />
              {row.activity > 0 && (
                <span className="ds-muted" style={{ marginLeft: "auto" }}>
                  ×{row.activity}
                </span>
              )}
              <span className={`ds-muted${row.activity > 0 ? "" : " ds-accordion__head-time"}`}>
                {formatTimeShort(regionStatusAt(row))}
              </span>
            </div>
            <div className="ds-event-card__row2">
              <span className="ds-event-card__row2-name">{row.name}</span>
              <span>{row.regionCode}</span>
            </div>
          </div>
        ),
        body: (
          <>
            <div className="ds-muted" style={{ fontSize: 12 }}>
              Статус с: {formatDateTime(regionStatusAt(row))}
            </div>
            <SourceMessageBlock regionCode={row.regionCode} />
            <button
              type="button"
              className="ds-accordion__head"
              style={{ width: "100%", marginTop: 8, justifyContent: "flex-start" }}
              onClick={() => selectRegion(row.regionCode)}
            >
              Контур на карте
            </button>
          </>
        ),
      };
    }),
    ...placeRows.map((row) => {
      const visual = resolveThreatVisual({ statusCode: row.statusCode });
      return {
        id: `place:${row.placeId}`,
        headTip: `${row.placeName}\n${row.regionCode} · ${statusTitle(row.statusCode)}`,
        head: (
          <div className="ds-event-card__head">
            <div className="ds-event-card__row1">
              <Badge level={row.stateLevel} />
              <ThreatIcon compact statusCode={row.statusCode} title={statusTitle(row.statusCode)} />
              <StatusReasonChip label={statusTitle(row.statusCode)} accentColor={visual?.accentColor} />
              <span className="ds-muted ds-accordion__head-time">
                {formatTimeShort(placeStatusAt(row))}
              </span>
            </div>
            <div className="ds-event-card__row2">
              <span className="ds-event-card__row2-name">{row.placeName}</span>
              <span>{row.regionCode}</span>
            </div>
          </div>
        ),
        body: (
          <>
            <div className="ds-muted" style={{ fontSize: 12 }}>
              Статус с: {formatDateTime(placeStatusAt(row))}
            </div>
            <div className="ds-muted">{statusTitle(row.statusCode)}</div>
            <SourceMessageBlock placeId={row.placeId} />
            <button
              type="button"
              className="ds-accordion__head"
              style={{ width: "100%", marginTop: 8, justifyContent: "flex-start" }}
              onClick={() => selectRegion(row.regionCode)}
            >
              Показать регион на карте
            </button>
          </>
        ),
      };
    }),
  ];

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
      title="Активные угрозы"
      actions={filterAction}
      variant="glass"
      collapsible
      defaultCollapsed={defaultCollapsed}
      persistenceKey={panelPersistenceKey}
    >
      {items.length === 0 ? (
        <p className="ds-muted">Нет активных угроз.</p>
      ) : (
        <Accordion items={items} />
      )}
    </Panel>
  );
}
