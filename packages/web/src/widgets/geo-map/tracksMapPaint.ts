/** MapLibre expression: цвет линии/точки по threatProfile. */
export function threatProfileColorExpression(): unknown {
  return [
    "match",
    ["get", "threatProfile"],
    "uav",
    "#FF9800",
    "rocket",
    "#F44336",
    "balloon",
    "#00BCD4",
    "unknown",
    "#9E9E9E",
    "#9E9E9E",
  ];
}

/** Paint origin-маркеров треков. Без затухания по status/времени — closed/stale так же видны. */
export function tracksOriginPaint(): Record<string, unknown> {
  return {
    "circle-radius": [
      "case",
      ["==", ["get", "stationary"], "true"],
      [
        "interpolate",
        ["linear"],
        ["zoom"],
        4,
        ["+", 5, ["min", 10, ["*", 1.2, ["coalesce", ["to-number", ["get", "nodeCount"]], 2]]]],
        8,
        ["+", 8, ["min", 14, ["*", 1.4, ["coalesce", ["to-number", ["get", "nodeCount"]], 2]]]],
        12,
        ["+", 12, ["min", 18, ["*", 1.6, ["coalesce", ["to-number", ["get", "nodeCount"]], 2]]]],
      ],
      ["interpolate", ["linear"], ["zoom"], 4, 4, 8, 7, 12, 11],
    ],
    "circle-color": threatProfileColorExpression(),
    "circle-stroke-color": "#ffffff",
    "circle-stroke-width": 1.5,
    "circle-opacity": 0.95,
  };
}

/** Paint линий L1-треков — одинаковая opacity для active/closed/stale. */
export function tracksLinesPaint(): Record<string, unknown> {
  return {
    "line-color": threatProfileColorExpression(),
    "line-width": 2.5,
    "line-opacity": 0.85,
  };
}

/** Paint L2 flow-коридоров (толщина ∝ weight). */
export function tracksFlowLinesPaint(): Record<string, unknown> {
  return {
    "line-color": threatProfileColorExpression(),
    "line-width": [
      "interpolate",
      ["linear"],
      ["get", "weight"],
      1,
      2,
      10,
      8,
    ],
    "line-opacity": 0.7,
  };
}
