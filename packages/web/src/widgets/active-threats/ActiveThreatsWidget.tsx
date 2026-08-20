import { useMemo } from "react";
import type { MapPlaceSnapshot, MapRegionSnapshot, StateLevel } from "@radar/shared";
import { resolveThreatVisual } from "@radar/shared";
import { Accordion, Panel } from "../../shared/ds";
import type { AccordionItem } from "../../shared/ds";
import { ThreatIcon } from "../../shared/ds/ThreatIcon";
import { EventCardHead } from "../../shared/components/EventCardHead";
import { EventTraitIcons } from "../../shared/components/EventTraitIcons";
import { SourceMessageBlock } from "../../shared/components/SourceMessageBlock";
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
      const reason = row.statusCode ? statusTitle(row.statusCode) : undefined;
      const visual = resolveThreatVisual({
        statusCode: row.statusCode,
        traits: row.traits,
        eventSubject: row.eventSubject,
      });

      return {
        id: `region:${row.regionCode}`,
        headTip: `${row.name}\n${row.regionCode}`,
        head: (
          <EventCardHead
            title={row.name}
            level={row.stateLevel}
            icon={
              <ThreatIcon
                compact
                statusCode={row.statusCode}
                traits={row.traits}
                eventSubject={row.eventSubject}
                title={reason}
              />
            }
            reason={reason}
            reasonColor={visual?.accentColor}
            traits={
              <EventTraitIcons
                compact
                mass={row.traits?.mass}
                uncertain={row.traits?.uncertain}
              />
            }
            time={formatTimeShort(regionStatusAt(row))}
            meta={
              <>
                <span className="ds-event-card__meta-code">{row.regionCode}</span>
                {row.activity > 0 && (
                  <span className="ds-event-card__meta-activity">×{row.activity}</span>
                )}
              </>
            }
          />
        ),
        body: (
          <>
            <dl className="ds-event-card__facts">
              <div className="ds-event-card__fact">
                <dt>Статус с</dt>
                <dd>{formatDateTime(regionStatusAt(row))}</dd>
              </div>
              {reason && (
                <div className="ds-event-card__fact">
                  <dt>Причина</dt>
                  <dd>{reason}</dd>
                </div>
              )}
            </dl>
            <SourceMessageBlock regionCode={row.regionCode} />
            <button
              type="button"
              className="ds-event-card__action"
              onClick={() => selectRegion(row.regionCode)}
            >
              Контур на карте
            </button>
          </>
        ),
      };
    }),
    ...placeRows.map((row) => {
      const reason = statusTitle(row.statusCode);
      const visual = resolveThreatVisual({ statusCode: row.statusCode });

      return {
        id: `place:${row.placeId}`,
        headTip: `${row.placeName}\n${row.regionCode} · ${reason}`,
        head: (
          <EventCardHead
            title={row.placeName}
            level={row.stateLevel}
            icon={
              <ThreatIcon compact statusCode={row.statusCode} title={reason} />
            }
            reason={reason}
            reasonColor={visual?.accentColor}
            time={formatTimeShort(placeStatusAt(row))}
            meta={<span className="ds-event-card__meta-code">{row.regionCode}</span>}
          />
        ),
        body: (
          <>
            <dl className="ds-event-card__facts">
              <div className="ds-event-card__fact">
                <dt>Статус с</dt>
                <dd>{formatDateTime(placeStatusAt(row))}</dd>
              </div>
              <div className="ds-event-card__fact">
                <dt>Причина</dt>
                <dd>{reason}</dd>
              </div>
            </dl>
            <SourceMessageBlock placeId={row.placeId} />
            <button
              type="button"
              className="ds-event-card__action"
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
      className="ds-event-card__action"
      style={{ marginTop: 0, padding: "2px 8px" }}
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
