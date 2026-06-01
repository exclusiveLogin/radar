import { useMemo } from "react";
import type { MapPlaceSnapshot, MapRegionSnapshot, StateLevel } from "@radar/shared";
import { Accordion, Badge, Panel } from "../../shared/ds";
import type { AccordionItem } from "../../shared/ds";
import { SourceMessageBlock } from "../../shared/components/SourceMessageBlock";
import { formatDateTime, formatTimeShort } from "../../shared/format/dateTime";
import { useObservable } from "../../shared/hooks/useObservable";
import { placesById$, regionsByCode$ } from "../../shared/state/mapStore";
import { selectRegion, selectedRegion$ } from "../../shared/state/selectionStore";
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

/** Текущие активные угрозы: region_state_active ≠ grey и place_status_active. */
export function ActiveThreatsWidget({ defaultCollapsed = false }: WidgetProps) {
  const regions = useObservable(regionsByCode$, new Map<string, MapRegionSnapshot>());
  const places = useObservable(placesById$, new Map<string, MapPlaceSnapshot>());
  const selected = useObservable(selectedRegion$, null);

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
    ...regionRows.map((row) => ({
      id: `region:${row.regionCode}`,
      headTip: `${row.name}\n${row.regionCode}`,
      head: (
        <>
          <Badge level={row.stateLevel} />
          <span>{row.name}</span>
          <span className="ds-muted">{row.regionCode}</span>
          {row.activity > 0 && (
            <span className="ds-muted" style={{ marginLeft: "auto" }}>
              ×{row.activity}
            </span>
          )}
          <span className="ds-muted">{formatTimeShort(regionStatusAt(row))}</span>
        </>
      ),
      body: (
        <>
          <div className="ds-muted" style={{ fontSize: 11 }}>
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
    })),
    ...placeRows.map((row) => ({
      id: `place:${row.placeId}`,
      headTip: `${row.placeName}\n${row.regionCode} · ${row.statusCode}`,
      head: (
        <>
          <Badge level={row.stateLevel} />
          <span>{row.placeName}</span>
          <span className="ds-muted">{row.regionCode}</span>
          <span className="ds-muted" style={{ marginLeft: "auto" }}>
            {formatTimeShort(placeStatusAt(row))}
          </span>
        </>
      ),
      body: (
        <>
          <div className="ds-muted" style={{ fontSize: 11 }}>
            Статус с: {formatDateTime(placeStatusAt(row))}
          </div>
          <div className="ds-muted">{row.statusCode}</div>
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
    })),
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
    <Panel title="Активные угрозы" actions={filterAction} variant="glass" collapsible defaultCollapsed={defaultCollapsed}>
      {items.length === 0 ? (
        <p className="ds-muted">Нет активных угроз.</p>
      ) : (
        <Accordion items={items} />
      )}
    </Panel>
  );
}
