import { useMemo } from "react";
import type { StateLevel } from "@radar/shared";
import { Donut, Panel, StatTile } from "../../shared/ds";
import { LEVEL_COLORS, LEVEL_LABELS } from "../../shared/config/mapConfig.service";
import { useObservable } from "../../shared/hooks/useObservable";
import {
  countRegionsByLevel,
  levelDonutSegments,
} from "../../shared/state/derivations";
import { regionsByCode$ } from "../../shared/state/mapStore";

const KPI_LEVELS: StateLevel[] = ["red", "orange", "yellow", "green", "grey"];

/** KPI-плитки по уровням + donut распределения регионов. */
export function OverviewStatsWidget() {
  const regions = useObservable(regionsByCode$, new Map());

  const counts = useMemo(() => countRegionsByLevel(regions), [regions]);
  const segments = useMemo(() => levelDonutSegments(counts), [counts]);
  const total = useMemo(
    () => KPI_LEVELS.reduce((sum, l) => sum + counts[l], 0),
    [counts],
  );

  return (
    <Panel title="Обзор" variant="glass" collapsible>
      <div className="ds-stat-grid">
        {KPI_LEVELS.map((level) => (
          <StatTile
            key={level}
            label={LEVEL_LABELS[level]}
            value={counts[level]}
            dotColor={LEVEL_COLORS[level]}
          />
        ))}
      </div>
      <div style={{ marginTop: 10 }}>
        <p className="ds-muted" style={{ margin: "0 0 6px", fontSize: 11 }}>
          Всего регионов: {total}
        </p>
        <Donut segments={segments} />
      </div>
    </Panel>
  );
}
