import { useMemo } from "react";
import type { MapRegionSnapshot } from "@radar/shared";
import { Panel } from "../../shared/ds";
import { LEVEL_COLORS, LEVEL_LABELS } from "../../shared/config/mapConfig.service";
import { formatDateTime } from "../../shared/format/dateTime";
import { useObservable } from "../../shared/hooks/useObservable";
import { regionsByCode$ } from "../../shared/state/mapStore";
import { selectRegion, selectedRegion$ } from "../../shared/state/selectionStore";
import type { WidgetProps } from "../widgetProps";

// Соты: pointy-top гексагоны, нечётные ряды со сдвигом на половину ширины.
const HEX_R = 28; // радиус соты (крупнее прежних кружков)
const HEX_W = Math.sqrt(3) * HEX_R; // ширина pointy-top гексагона
const HEX_VSTEP = 1.5 * HEX_R; // шаг между рядами
const PADDING = 16;

/** Вершины pointy-top гексагона (верхняя вершина строго вверх). */
function hexPoints(cx: number, cy: number, r: number): string {
  const points: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 180) * (60 * i - 90);
    points.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
  }
  return points.join(" ");
}

/** Центр соты по тайлу layout (col/row) с honeycomb-сдвигом нечётных рядов. */
function hexCenter(col: number, row: number): { cx: number; cy: number } {
  const offset = row % 2 === 1 ? HEX_W / 2 : 0;
  return {
    cx: PADDING + col * HEX_W + offset + HEX_W / 2,
    cy: PADDING + row * HEX_VSTEP + HEX_R,
  };
}

/** Схема обстановки: регион = крупная сота (honeycomb), цвет = уровень состояния. */
export function SchematicMapWidget(_props: WidgetProps) {
  const regions = useObservable(regionsByCode$, new Map<string, MapRegionSnapshot>());
  const selected = useObservable(selectedRegion$, null);

  /** Все субъекты с координатой в layout.json (фиксированная географическая сетка). */
  const layoutRegions = useMemo(
    () => [...regions.values()].filter((region) => region.layout),
    [regions],
  );

  const dims = useMemo(() => {
    if (layoutRegions.length === 0) return { cols: 0, rows: 0 };
    const cols = Math.max(...layoutRegions.map((t) => t.layout!.col)) + 1;
    const rows = Math.max(...layoutRegions.map((t) => t.layout!.row)) + 1;
    return { cols, rows };
  }, [layoutRegions]);

  // +HEX_W/2 — запас под honeycomb-сдвиг нечётных рядов.
  const width = dims.cols * HEX_W + HEX_W / 2 + PADDING * 2;
  const height = (Math.max(dims.rows - 1, 0)) * HEX_VSTEP + HEX_R * 2 + PADDING * 2;

  return (
    <Panel title="Схема обстановки" variant="glass" className="schematic-panel" collapsible>
      {layoutRegions.length === 0 ? (
        <p className="ds-muted">Нет регионов в layout.json.</p>
      ) : (
        <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img">
          {layoutRegions.map((region) => {
            const { cx, cy } = hexCenter(region.layout!.col, region.layout!.row);
            const isSelected = region.regionCode === selected;
            return (
              <g
                key={region.regionCode}
                onClick={() => selectRegion(region.regionCode)}
                style={{ cursor: "pointer" }}
              >
                <title>
                  {[
                    `${region.regionCode} — ${region.name}`,
                    LEVEL_LABELS[region.stateLevel],
                    region.activity > 0 ? `×${region.activity}` : null,
                    region.statusEventAt
                      ? `статус с ${formatDateTime(region.statusEventAt)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join("\n")}
                </title>
                <polygon
                  points={hexPoints(cx, cy, HEX_R - 1.5)}
                  fill={LEVEL_COLORS[region.stateLevel]}
                  stroke={isSelected ? "#fff" : "#0d0f14"}
                  strokeWidth={isSelected ? 2.5 : 1}
                  strokeLinejoin="round"
                />
                <text
                  x={cx}
                  y={cy + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={12}
                  fill={region.stateLevel === "grey" ? "#c8cdd6" : "#0d0f14"}
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
