import { useMemo } from "react";
import { Badge, Panel } from "../../shared/ds";
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
          {top.map((row, idx) => (
            <li
              key={row.regionCode}
              className="ds-trend-list__item"
              onClick={() => selectRegion(row.regionCode)}
              onKeyDown={(e) => {
                if (e.key === "Enter") selectRegion(row.regionCode);
              }}
              role="button"
              tabIndex={0}
            >
              <span className="ds-trend-list__rank">{idx + 1}</span>
              <Badge level={row.stateLevel} />
              <span>{row.regionCode.replace("RU-", "")}</span>
              <span className="ds-muted">{row.name}</span>
              <span className="ds-trend-list__activity">×{row.activity}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
