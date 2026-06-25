import { useMemo } from "react";
import type { StateLevel } from "@radar/shared";
import { Donut, Panel, StatTile } from "../../shared/ds";
import { LEVEL_COLORS, LEVEL_LABELS } from "../../shared/config/mapConfig.service";
import { useBehaviorSubject } from "../../shared/hooks/useBehaviorSubject";
import {
  countPlacesOnMapByLevel,
  countRegionsByLevel,
  countVisiblePlacesOnMap,
  levelDonutSegments,
} from "../../shared/state/derivations";
import { placesById$, regionsByCode$ } from "../../shared/state/mapStore";

const KPI_LEVELS: StateLevel[] = ["red", "orange", "yellow", "green", "grey"];

import type { WidgetProps } from "../widgetProps";

/** KPI-плитки по уровням + donut распределения регионов. */
const PLACE_LEVELS: StateLevel[] = ["red", "orange", "yellow", "green"];

export function OverviewStatsWidget({ panelPersistenceKey }: WidgetProps) {
  const regions = useBehaviorSubject(regionsByCode$);
  const places = useBehaviorSubject(placesById$);

  const regionCounts = useMemo(() => countRegionsByLevel(regions), [regions]);
  const regionSegments = useMemo(
    () => levelDonutSegments(regionCounts),
    [regionCounts],
  );
  const regionTotal = useMemo(
    () => KPI_LEVELS.reduce((sum, l) => sum + regionCounts[l], 0),
    [regionCounts],
  );

  const placeCounts = useMemo(
    () => countPlacesOnMapByLevel(places, regions),
    [places, regions],
  );
  const placesVisible = useMemo(
    () => countVisiblePlacesOnMap(places, regions),
    [places, regions],
  );

  return (
    <Panel title="Обзор" variant="glass" collapsible persistenceKey={panelPersistenceKey}>
      <p className="ds-muted" style={{ margin: "0 0 6px", fontSize: 11 }}>
        Регионы
      </p>
      <div className="ds-stat-grid">
        {KPI_LEVELS.map((level) => (
          <StatTile
            key={`region-${level}`}
            label={LEVEL_LABELS[level]}
            value={regionCounts[level]}
            dotColor={LEVEL_COLORS[level]}
          />
        ))}
      </div>
      <div style={{ marginTop: 10 }}>
        <p className="ds-muted" style={{ margin: "0 0 6px", fontSize: 11 }}>
          Всего регионов: {regionTotal}
        </p>
        <Donut segments={regionSegments} />
      </div>

      <p className="ds-muted" style={{ margin: "12px 0 6px", fontSize: 11 }}>
        Места на карте ({placesVisible})
      </p>
      <div className="ds-stat-grid">
        {PLACE_LEVELS.map((level) => (
          <StatTile
            key={`place-${level}`}
            label={LEVEL_LABELS[level]}
            value={placeCounts[level]}
            dotColor={LEVEL_COLORS[level]}
          />
        ))}
      </div>
    </Panel>
  );
}
