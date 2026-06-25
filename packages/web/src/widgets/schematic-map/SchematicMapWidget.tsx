import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { MapRegionSnapshot, StateChangeEventItem, StateLevel } from "@radar/shared";
import { Panel } from "../../shared/ds";
import { LEVEL_COLORS, LEVEL_LABELS } from "../../shared/config/mapConfig.service";
import { formatDateTime } from "../../shared/format/dateTime";
import { isRegionVisibleOnMap } from "../../shared/state/derivations";
import { derivedRegionCodes$, mapViewAnchor$, regionsByCode$ } from "../../shared/state/mapStore";
import { selectRegion, selectedRegion$ } from "../../shared/state/selectionStore";
import { stateChangesFeed$ } from "../../shared/state/stateChangesFeedStore";
import { regionFadeFactor } from "../../shared/utils/regionFade";
import type { WidgetProps } from "../widgetProps";
import {
  buildCompactLayoutGrid,
  compactTile,
  fitViewBoxFromCenters,
} from "./compactLayoutGrid";

const HEX_R = 28;
const HEX_W = Math.sqrt(3) * HEX_R;
const HEX_VSTEP = 1.5 * HEX_R;
const PADDING = 16;

const LEVEL_Z: Record<StateLevel, number> = {
  grey: 0,
  green: 1,
  yellow: 2,
  orange: 3,
  red: 4,
};

function hexPoints(cx: number, cy: number, r: number): string {
  const points: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 180) * (60 * i - 90);
    points.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
  }
  return points.join(" ");
}

function hexCenter(col: number, row: number): { cx: number; cy: number } {
  const offset = row % 2 === 1 ? HEX_W / 2 : 0;
  return {
    cx: PADDING + col * HEX_W + offset + HEX_W / 2,
    cy: PADDING + row * HEX_VSTEP + HEX_R,
  };
}

function regionHoverTip(
  region: MapRegionSnapshot,
  recentEvent: StateChangeEventItem | undefined,
  isDerived: boolean,
): string {
  return [
    `${region.regionCode} — ${region.name}`,
    isDerived ? `${LEVEL_LABELS[region.stateLevel]} (производный)` : LEVEL_LABELS[region.stateLevel],
    recentEvent?.eventType ? `тип: ${recentEvent.eventType}` : null,
    region.activity > 0 ? `×${region.activity}` : null,
    region.statusEventAt ? `статус с ${formatDateTime(region.statusEventAt)}` : null,
    recentEvent?.displayText ?? recentEvent?.rawText
      ? (recentEvent.displayText ?? recentEvent.rawText).slice(0, 80)
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

type HoverTip = {
  region: MapRegionSnapshot;
  x: number;
  y: number;
};

/** Схема: уплотнённый honeycomb, подсказка в portal (не режется glass-панелью). */
export function SchematicMapWidget({ panelPersistenceKey }: WidgetProps) {
  // Прямая подписка — инициализируется текущим значением, обновляется при каждой эмиссии.
  const [regions, setRegions] = useState(() => regionsByCode$.getValue());
  const [selected, setSelected] = useState(() => selectedRegion$.getValue());
  const [hoverTip, setHoverTip] = useState<HoverTip | null>(null);
  const [derivedCodes, setDerivedCodes] = useState(() => derivedRegionCodes$.getValue());
  const [feedItems, setFeedItems] = useState(() => stateChangesFeed$.getValue());
  // SSOT fade-якоря — mapViewAnchor$ (live-тик 60с в startMapStore).
  const [now, setNow] = useState(() => mapViewAnchor$.getValue());

  useEffect(() => {
    const sub = mapViewAnchor$.subscribe(setNow);
    return () => sub.unsubscribe();
  }, []);

  useEffect(() => {
    setRegions(regionsByCode$.getValue());
    const sub = regionsByCode$.subscribe(setRegions);
    return () => sub.unsubscribe();
  }, []);

  useEffect(() => {
    setSelected(selectedRegion$.getValue());
    const sub = selectedRegion$.subscribe(setSelected);
    return () => sub.unsubscribe();
  }, []);

  useEffect(() => {
    setDerivedCodes(derivedRegionCodes$.getValue());
    const sub = derivedRegionCodes$.subscribe(setDerivedCodes);
    return () => sub.unsubscribe();
  }, []);

  useEffect(() => {
    setFeedItems(stateChangesFeed$.getValue());
    const sub = stateChangesFeed$.subscribe(setFeedItems);
    return () => sub.unsubscribe();
  }, []);

  /** Ищем самое свежее событие ленты для данного региона. */
  const recentEventByCode = useMemo(() => {
    const map = new Map<string, StateChangeEventItem>();
    for (const item of feedItems) {
      for (const code of item.regionCodes) {
        if (!map.has(code)) map.set(code, item);
      }
    }
    return map;
  }, [feedItems]);

  const layoutRegions = useMemo(
    () => [...regions.values()].filter((region) => region.layout),
    [regions],
  );

  const compactGrid = useMemo(
    () => buildCompactLayoutGrid(layoutRegions),
    [layoutRegions],
  );

  const activeRegions = useMemo(
    () => layoutRegions.filter((region) => isRegionVisibleOnMap(region, now)),
    [layoutRegions, now],
  );

  const tiles = useMemo(
    () =>
      [...layoutRegions]
        .filter((region) => isRegionVisibleOnMap(region, now))
        .sort((a, b) => LEVEL_Z[a.stateLevel] - LEVEL_Z[b.stateLevel]),
    [layoutRegions, now],
  );

  const fullWidth =
    (compactGrid?.compactCols ?? 0) * HEX_W + HEX_W / 2 + PADDING * 2;
  const fullHeight =
    (Math.max((compactGrid?.compactRows ?? 1) - 1, 0)) * HEX_VSTEP +
    HEX_R * 2 +
    PADDING * 2;

  const viewBox = useMemo(() => {
    if (!compactGrid) return `0 0 ${fullWidth} ${fullHeight}`;
    const centers = activeRegions.map((region) => {
      const tile = compactTile(
        compactGrid,
        region.layout!.col,
        region.layout!.row,
      );
      return hexCenter(tile.col, tile.row);
    });
    return fitViewBoxFromCenters(centers, HEX_R, PADDING, {
      width: fullWidth,
      height: fullHeight,
    });
  }, [activeRegions, compactGrid, fullWidth, fullHeight]);

  const tooltipPortal =
    hoverTip &&
    createPortal(
      <div
        className="schematic-hex-tip"
        style={{ left: hoverTip.x + 12, top: hoverTip.y + 12 }}
        role="tooltip"
      >
        {regionHoverTip(
          hoverTip.region,
          recentEventByCode.get(hoverTip.region.regionCode),
          derivedCodes.has(hoverTip.region.regionCode),
        )
          .split("\n")
          .map((line) => (
            <div key={line}>{line}</div>
          ))}
      </div>,
      document.body,
    );

  return (
    <Panel
      title="Схема обстановки"
      variant="glass"
      className="schematic-panel"
      collapsible
      persistenceKey={panelPersistenceKey}
    >
      {layoutRegions.length === 0 || !compactGrid ? (
        <p className="ds-muted">Нет регионов в layout.json.</p>
      ) : (
        <div className="schematic-panel__canvas">
          <svg
            width="100%"
            viewBox={viewBox}
            preserveAspectRatio="xMidYMid meet"
            role="img"
          >
            {tiles.map((region) => {
              const tile = compactTile(
                compactGrid,
                region.layout!.col,
                region.layout!.row,
              );
              const { cx, cy } = hexCenter(tile.col, tile.row);
              const isSelected = region.regionCode === selected;
              const isGrey = region.stateLevel === "grey";
              const fade = isGrey ? 1 : regionFadeFactor(region.statusEventAt, now);

              return (
                <g
                  key={region.regionCode}
                  onClick={() => selectRegion(region.regionCode === selected ? null : region.regionCode)}
                  style={{ cursor: "pointer" }}
                >
                  <polygon
                    points={hexPoints(cx, cy, HEX_R - 1.5)}
                    fill={isGrey ? "#252830" : LEVEL_COLORS[region.stateLevel]}
                    fillOpacity={isGrey ? 0.85 : fade}
                    stroke={
                      isSelected ? "#fff" : isGrey ? "#3d4452" : "#0d0f14"
                    }
                    strokeOpacity={isGrey ? 1 : fade}
                    strokeWidth={isSelected ? 2.5 : 1}
                    strokeLinejoin="round"
                    onMouseEnter={(event) => {
                      setHoverTip({
                        region,
                        x: event.clientX,
                        y: event.clientY,
                      });
                    }}
                    onMouseMove={(event) => {
                      setHoverTip({
                        region,
                        x: event.clientX,
                        y: event.clientY,
                      });
                    }}
                    onMouseLeave={() => setHoverTip(null)}
                  />
                  {!isGrey ? (
                    <text
                      x={cx}
                      y={cy + 1}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={11}
                      fill="#0d0f14"
                      fontWeight={700}
                      pointerEvents="none"
                    >
                      {region.regionCode.replace("RU-", "")}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
          {tooltipPortal}
        </div>
      )}
    </Panel>
  );
}
