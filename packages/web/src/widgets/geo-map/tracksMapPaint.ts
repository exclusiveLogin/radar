import type { ThreatProfile } from "@radar/shared";

/** SSOT: толщина и прозрачность статических L1-линий (MapLibre). */
export const TRACKS_STATIC_LINE_WIDTH = 1.2;
export const TRACKS_STATIC_LINE_OPACITY = 0.35;

/** SSOT: RGBA по threatProfile — для Deck.gl TripsLayer и MapLibre hex. */
const THREAT_PROFILE_COLORS: Record<ThreatProfile, [number, number, number]> = {
  uav: [255, 152, 0],
  rocket: [244, 67, 54],
  balloon: [0, 188, 212],
  unknown: [158, 158, 158],
};

/** RGBA для Deck.gl (opacity 0–255). */
export function threatProfileRgba(
  profile: ThreatProfile,
  alpha = 230,
): [number, number, number, number] {
  const [r, g, b] = THREAT_PROFILE_COLORS[profile] ?? THREAT_PROFILE_COLORS.unknown;
  return [r, g, b, alpha];
}

function threatProfileHex(profile: ThreatProfile): string {
  const [r, g, b] = THREAT_PROFILE_COLORS[profile] ?? THREAT_PROFILE_COLORS.unknown;
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/** MapLibre expression: цвет линии/точки по threatProfile. */
export function threatProfileColorExpression(): unknown {
  return [
    "match",
    ["get", "threatProfile"],
    "uav",
    threatProfileHex("uav"),
    "rocket",
    threatProfileHex("rocket"),
    "balloon",
    threatProfileHex("balloon"),
    "unknown",
    threatProfileHex("unknown"),
    threatProfileHex("unknown"),
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

/**
 * Paint линий L1-треков — тонкие, но читаемые на обзорной карте.
 *
 * MapLibre НЕ поддерживает data-driven `line-dasharray` (по feature property),
 * поэтому пунктир задаётся статически через флаг `dashed`, а разделение
 * сплошных/пунктирных линий делается на уровне `filter` отдельных слоёв.
 *
 * Пунктир (segment_only) виден только пока pipeline в фазе билда — см. tracksPipelineActive$.
 *
 * @param dashed true — статический пунктир (слой tracks-lines-dashed).
 */
export function tracksLinesPaint(dashed = false): Record<string, unknown> {
  return {
    "line-color": threatProfileColorExpression(),
    "line-width": [
      "interpolate",
      ["linear"],
      ["zoom"],
      4,
      1,
      8,
      TRACKS_STATIC_LINE_WIDTH,
      12,
      2.4,
    ],
    ...(dashed ? { "line-dasharray": [2, 2] } : {}),
    "line-opacity": [
      "interpolate",
      ["linear"],
      ["zoom"],
      4,
      0.55,
      8,
      TRACKS_STATIC_LINE_OPACITY,
      12,
      0.75,
    ],
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
