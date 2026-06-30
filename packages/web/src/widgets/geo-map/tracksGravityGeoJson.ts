import type { TracksGravityResponse } from "@radar/shared";
import type { ThemeMode } from "../../shared/state/themeStore";

import { emptyTracksFeatureCollection, type TracksGeoJsonCollection } from "./tracksGeoJson";

/** Gravity → чистый FeatureCollection для MapLibre (без asOf в корне). */
export function tracksGravityToGeoJson(
  response: TracksGravityResponse | null,
): TracksGeoJsonCollection | { type: "FeatureCollection"; features: TracksGravityResponse["features"] } {
  if (!response?.features.length) return emptyTracksFeatureCollection();
  return { type: "FeatureCollection", features: response.features };
}

/** Paint heatmap-слоя гравитации (weight = mass узлов в зоне). */
export function tracksGravityHeatmapPaint(_theme: ThemeMode): Record<string, unknown> {
  return {
    "heatmap-weight": [
      "interpolate",
      ["linear"],
      ["coalesce", ["get", "mass"], 1],
      1,
      0.35,
      5,
      0.55,
      20,
      0.85,
      50,
      1,
    ],
    "heatmap-intensity": [
      "interpolate",
      ["linear"],
      ["zoom"],
      0,
      0.85,
      6,
      1.1,
      10,
      1.4,
    ],
    "heatmap-radius": [
      "interpolate",
      ["linear"],
      ["coalesce", ["get", "mass"], 1],
      1,
      18,
      5,
      24,
      20,
      36,
      50,
      48,
    ],
    "heatmap-opacity": 0.75,
    "heatmap-color": [
      "interpolate",
      ["linear"],
      ["heatmap-density"],
      0,
      "rgba(0,0,0,0)",
      0.2,
      "rgba(127,116,90,0.34)",
      0.5,
      "rgba(189,130,66,0.56)",
      0.8,
      "rgba(206,110,52,0.76)",
      1,
      "rgba(164,68,38,0.9)",
    ],
  };
}
