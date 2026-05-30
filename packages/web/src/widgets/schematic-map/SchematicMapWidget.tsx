import { useMemo } from "react";
import type { MapRegionSnapshot } from "@radar/shared";
import { Panel } from "../../shared/ds";
import { LEVEL_COLORS } from "../../shared/config/mapConfig.service";
import { useObservable } from "../../shared/hooks/useObservable";
import { regionsByCode$ } from "../../shared/state/mapStore";
import { selectRegion, selectedRegion$ } from "../../shared/state/selectionStore";
import type { WidgetProps } from "../widgetProps";

const CELL = 46;
const PADDING = 18;
const BASE_R = 13;

/** Радиус кружка региона: база + вклад activity (визуальная острота). */
function radiusFor(activity: number): number {
  return BASE_R + Math.min(activity, 6) * 1.6;
}

/** Схематичная карта-сетка: регион = кружок в тайле layout, цвет = уровень. */
export function SchematicMapWidget(_props: WidgetProps) {
  const regions = useObservable(regionsByCode$, new Map<string, MapRegionSnapshot>());
  const selected = useObservable(selectedRegion$, null);

  const tiles = useMemo(
    () => [...regions.values()].filter((region) => region.layout),
    [regions],
  );

  const dims = useMemo(() => {
    const cols = Math.max(0, ...tiles.map((t) => t.layout!.col)) + 1;
    const rows = Math.max(0, ...tiles.map((t) => t.layout!.row)) + 1;
    return { cols, rows };
  }, [tiles]);

  const width = dims.cols * CELL + PADDING * 2;
  const height = dims.rows * CELL + PADDING * 2;

  return (
    <Panel title="Схема обстановки" variant="glass" className="schematic-panel" collapsible>
      {tiles.length === 0 ? (
        <p className="ds-muted">Нет регионов с раскладкой (layout.json).</p>
      ) : (
        <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img">
          {tiles.map((region) => {
            const cx = PADDING + region.layout!.col * CELL + CELL / 2;
            const cy = PADDING + region.layout!.row * CELL + CELL / 2;
            const isSelected = region.regionCode === selected;
            return (
              <g
                key={region.regionCode}
                onClick={() => selectRegion(region.regionCode)}
                style={{ cursor: "pointer" }}
              >
                <circle
                  cx={cx}
                  cy={cy}
                  r={radiusFor(region.activity)}
                  fill={LEVEL_COLORS[region.stateLevel]}
                  stroke={isSelected ? "#fff" : "#0d0f14"}
                  strokeWidth={isSelected ? 2.5 : 1}
                />
                <text
                  x={cx}
                  y={cy + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={9}
                  fill="#0d0f14"
                  fontWeight={700}
                >
                  {region.regionCode.replace("RU-", "")}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </Panel>
  );
}
