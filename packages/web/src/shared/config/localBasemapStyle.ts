/**
 * Локальная vector-подложка (TileServer GL: /data/{theme}.json + /fonts).
 * Рендер в MapLibre — без server-side PNG (/styles/.../z/x/y.png), там 500 на подписях.
 */

type BasemapPalette = {
  background: string;
  landcover: string;
  landuse: string;
  water: string;
  waterway: string;
  road: string;
  building: string;
  boundary: string;
  placeCity: string;
  placeTown: string;
  placeVillage: string;
  placeHalo: string;
};

const DARK: BasemapPalette = {
  background: "#11141a",
  landcover: "#1a2330",
  landuse: "#1e2836",
  water: "#0f2d45",
  waterway: "#1a4a6e",
  road: "#4a5568",
  building: "#2d3748",
  boundary: "#718096",
  placeCity: "#e2e8f0",
  placeTown: "#cbd5e0",
  placeVillage: "#a0aec0",
  placeHalo: "#11141a",
};

const LIGHT: BasemapPalette = {
  background: "#e8eaed",
  landcover: "#e2e8d8",
  landuse: "#ebe9e4",
  water: "#aad3df",
  waterway: "#7eb8cc",
  road: "#ffffff",
  building: "#d9d5d0",
  boundary: "#9aa0a6",
  placeCity: "#2d3748",
  placeTown: "#4a5568",
  placeVillage: "#718096",
  placeHalo: "#ffffff",
};

/** Слои openmaptiles-подобной схемы; sourceId — ключ vector source в style. */
function basemapLayers(sourceId: string, p: BasemapPalette): object[] {
  return [
    { id: "basemap-bg", type: "background", paint: { "background-color": p.background } },
    {
      id: "basemap-landcover",
      type: "fill",
      source: sourceId,
      "source-layer": "landcover",
      paint: { "fill-color": p.landcover, "fill-opacity": 0.9 },
    },
    {
      id: "basemap-landuse",
      type: "fill",
      source: sourceId,
      "source-layer": "landuse",
      minzoom: 4,
      paint: { "fill-color": p.landuse, "fill-opacity": 0.85 },
    },
    {
      id: "basemap-water",
      type: "fill",
      source: sourceId,
      "source-layer": "water",
      minzoom: 4,
      paint: { "fill-color": p.water },
    },
    {
      id: "basemap-waterway",
      type: "line",
      source: sourceId,
      "source-layer": "waterway",
      minzoom: 8,
      paint: { "line-color": p.waterway, "line-width": 1 },
    },
    {
      id: "basemap-road",
      type: "line",
      source: sourceId,
      "source-layer": "transportation",
      minzoom: 4,
      paint: {
        "line-color": p.road,
        "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.3, 10, 1.5, 14, 3],
      },
    },
    {
      id: "basemap-building",
      type: "fill",
      source: sourceId,
      "source-layer": "building",
      minzoom: 12,
      paint: { "fill-color": p.building, "fill-opacity": 0.75 },
    },
    {
      id: "basemap-boundary",
      type: "line",
      source: sourceId,
      "source-layer": "boundary",
      paint: { "line-color": p.boundary, "line-width": 1, "line-dasharray": [2, 2] },
    },
    {
      id: "basemap-place-city",
      type: "symbol",
      source: sourceId,
      "source-layer": "place",
      filter: ["==", "class", "city"],
      minzoom: 4,
      layout: {
        "text-field": "{name:latin}",
        "text-font": ["Noto Sans Regular"],
        "text-size": 14,
      },
      paint: {
        "text-color": p.placeCity,
        "text-halo-color": p.placeHalo,
        "text-halo-width": 1.5,
      },
    },
    {
      id: "basemap-place-town",
      type: "symbol",
      source: sourceId,
      "source-layer": "place",
      filter: ["==", "class", "town"],
      minzoom: 6,
      layout: {
        "text-field": "{name:latin}",
        "text-font": ["Noto Sans Regular"],
        "text-size": 12,
      },
      paint: {
        "text-color": p.placeTown,
        "text-halo-color": p.placeHalo,
        "text-halo-width": 1.2,
      },
    },
    {
      id: "basemap-place-village",
      type: "symbol",
      source: sourceId,
      "source-layer": "place",
      filter: ["in", "class", "village", "hamlet", "suburb"],
      minzoom: 9,
      layout: {
        "text-field": "{name:latin}",
        "text-font": ["Noto Sans Regular"],
        "text-size": 11,
      },
      paint: {
        "text-color": p.placeVillage,
        "text-halo-color": p.placeHalo,
        "text-halo-width": 1,
      },
    },
  ];
}

/** MapLibre style: vector .pbf с TileServer + подписи НП в браузере. */
export function createLocalBasemapStyle(theme: "dark" | "light", tilesBaseUrl: string) {
  const base = tilesBaseUrl.replace(/\/$/, "");
  const palette = theme === "light" ? LIGHT : DARK;
  const sourceId = "basemap";

  return {
    version: 8 as const,
    name: `radar-local-${theme}`,
    glyphs: `${base}/fonts/{fontstack}/{range}.pbf`,
    sources: {
      [sourceId]: {
        type: "vector" as const,
        // Прямой шаблон тайлов — без tilejson (там TileServer отдаёт абсолютный http://127.0.0.1:8081/...).
        tiles: [`${base}/data/${theme}/{z}/{x}/{y}.pbf`],
        maxzoom: 14,
        attribution: "&copy; OpenStreetMap contributors",
      },
    },
    layers: basemapLayers(sourceId, palette),
  };
}
