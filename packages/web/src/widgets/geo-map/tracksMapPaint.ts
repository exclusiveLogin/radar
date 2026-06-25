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

/** Paint линий L1-треков (debug MVP). */
export function tracksLinesPaint(): Record<string, unknown> {
  return {
    "line-color": threatProfileColorExpression(),
    "line-width": 2.5,
    "line-opacity": 0.85,
  };
}

/** Paint origin-маркеров треков. */
export function tracksOriginPaint(): Record<string, unknown> {
  return {
    "circle-radius": 4,
    "circle-color": threatProfileColorExpression(),
    "circle-stroke-color": "#ffffff",
    "circle-stroke-width": 1.5,
    "circle-opacity": 0.9,
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
