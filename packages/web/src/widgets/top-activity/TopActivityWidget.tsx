import { useMemo } from "react";
import { Badge, EllipsisText, Panel, Tip } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import { topRegionsByActivity } from "../../shared/state/derivations";
import { regionsByCode$ } from "../../shared/state/mapStore";
import { selectRegion } from "../../shared/state/selectionStore";
import type { WidgetProps } from "../widgetProps";

/** Топ регионов по activity (trending-список). */
export function TopActivityWidget({ defaultCollapsed = false }: WidgetProps) {
  const regions = useObservable(regionsByCode$, new Map());

  const top = useMemo(() => topRegionsByActivity(regions, 10), [regions]);

  return (
    <Panel title="Топ активности" variant="glass" collapsible defaultCollapsed={defaultCollapsed}>
      {top.length === 0 ? (
        <p className="ds-muted">Нет активных регионов.</p>
      ) : (
        <ul className="ds-trend-list">
          {top.map((row, idx) => {
            const tip = `${row.regionCode} — ${row.name}\nАктивность: ×${row.activity}`;
            return (
              <li
                key={row.regionCode}
                className="ds-trend-list__item"
                title={tip}
                onClick={() => selectRegion(row.regionCode)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") selectRegion(row.regionCode);
                }}
                role="button"
                tabIndex={0}
              >
                <span className="ds-trend-list__rank">{idx + 1}</span>
                <Badge level={row.stateLevel} />
                <Tip label={row.regionCode}>
                  <span>{row.regionCode.replace("RU-", "")}</span>
                </Tip>
                <EllipsisText
                  text={row.name}
                  className="ds-trend-list__name ds-ellipsis"
                  tip={tip}
                />
                <span className="ds-trend-list__activity">×{row.activity}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
