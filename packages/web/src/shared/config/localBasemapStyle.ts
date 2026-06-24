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

/** Крупные города (OpenMapTiles place.rank): Москва, СПб, миллионники — с z3. */
const PLACE_CITY_MAJOR_MAX_RANK = 5;

/** Обзорка на всю зону; детальный запад — второй vector source (tiles.manifest detail bbox). */
const BASEMAP_OVERVIEW_MAX_ZOOM = 11;
const BASEMAP_DETAIL_MAX_ZOOM = 13;

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
      minzoom: 2,
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
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          4,
          0.3,
          10,
          1.5,
          BASEMAP_OVERVIEW_MAX_ZOOM,
          2.5,
        ],
      },
    },
    {
      id: "basemap-boundary",
      type: "line",
      source: sourceId,
      "source-layer": "boundary",
      paint: { "line-color": p.boundary, "line-width": 1, "line-dasharray": [2, 2] },
    },
    {
      id: "basemap-place-city-major",
      type: "symbol",
      source: sourceId,
      "source-layer": "place",
      filter: [
        "all",
        ["==", ["get", "class"], "city"],
        ["<=", ["coalesce", ["get", "rank"], 99], PLACE_CITY_MAJOR_MAX_RANK],
      ],
      minzoom: 3,
      layout: {
        "text-field": "{name:latin}",
        "text-font": ["Noto Sans Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 3, 12, 8, 14],
      },
      paint: {
        "text-color": p.placeCity,
        "text-halo-color": p.placeHalo,
        "text-halo-width": 1.5,
      },
    },
    {
      id: "basemap-place-city",
      type: "symbol",
      source: sourceId,
      "source-layer": "place",
      filter: [
        "all",
        ["==", ["get", "class"], "city"],
        [">", ["coalesce", ["get", "rank"], 99], PLACE_CITY_MAJOR_MAX_RANK],
      ],
      minzoom: 5,
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
      filter: ["==", ["get", "class"], "town"],
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
  ];
}

/** Детальный запад: НП, мелкие дороги, здания — только где есть detail-тайлы. */
function basemapDetailLayers(sourceId: string, p: BasemapPalette): object[] {
  return [
    {
      id: "basemap-detail-waterway",
      type: "line",
      source: sourceId,
      "source-layer": "waterway",
      minzoom: 6,
      paint: { "line-color": p.waterway, "line-width": 1 },
    },
    {
      id: "basemap-detail-road",
      type: "line",
      source: sourceId,
      "source-layer": "transportation",
      minzoom: 10,
      paint: {
        "line-color": p.road,
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10,
          0.6,
          13,
          2.5,
        ],
      },
    },
    {
      id: "basemap-detail-building",
      type: "fill",
      source: sourceId,
      "source-layer": "building",
      minzoom: 12,
      paint: { "fill-color": p.building, "fill-opacity": 0.75 },
    },
    {
      id: "basemap-detail-place-town",
      type: "symbol",
      source: sourceId,
      "source-layer": "place",
      filter: ["==", ["get", "class"], "town"],
      minzoom: 8,
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
      id: "basemap-detail-place-village",
      type: "symbol",
      source: sourceId,
      "source-layer": "place",
      filter: ["in", ["get", "class"], ["literal", ["village", "hamlet", "suburb"]]],
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
  const overviewId = "basemap";
  const detailId = "basemap-detail";

  return {
    version: 8 as const,
    name: `radar-local-${theme}`,
    glyphs: `${base}/fonts/{fontstack}/{range}.pbf`,
    sources: {
      [overviewId]: {
        type: "vector" as const,
        tiles: [`${base}/data/${theme}/{z}/{x}/{y}.pbf`],
        maxzoom: BASEMAP_OVERVIEW_MAX_ZOOM,
        attribution: "&copy; OpenStreetMap contributors",
      },
      [detailId]: {
        type: "vector" as const,
        tiles: [`${base}/data/${theme}-detail/{z}/{x}/{y}.pbf`],
        maxzoom: BASEMAP_DETAIL_MAX_ZOOM,
      },
    },
    layers: [
      ...basemapLayers(overviewId, palette),
      ...basemapDetailLayers(detailId, palette),
    ],
  };
}
