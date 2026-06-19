import type { ThemeMode } from "../state/themeStore";
import type { StateLevel } from "@radar/shared";

/**
 * Конфиг карты и темы: SSOT цветов уровней состояния (используется и схемой, и MapLibre, и бейджами).
 * Доменная семантика уровней — в shared; здесь только визуальное представление.
 */
export const LEVEL_COLORS: Record<StateLevel, string> = {
  grey: "#384050",
  green: "#3ba55d",
  yellow: "#c8a800",
  orange: "#d9680a",
  red: "#d93535",
};

export const LEVEL_LABELS: Record<StateLevel, string> = {
  grey: "Нет данных",
  green: "Отбой",
  yellow: "Внимание (сосед)",
  orange: "Внимание",
  red: "Опасность",
};

/** MapLibre: цвет заливки/контура по stateLevel в GeoJSON (не по закешированному color). */
export function regionStateLevelColorExpression(): unknown[] {
  return [
    "match",
    ["get", "stateLevel"],
    "red",
    LEVEL_COLORS.red,
    "orange",
    LEVEL_COLORS.orange,
    "yellow",
    LEVEL_COLORS.yellow,
    "green",
    LEVEL_COLORS.green,
    "grey",
    LEVEL_COLORS.grey,
    LEVEL_COLORS.grey,
  ];
}

/** Режим подложки гео-карты (VITE_MAP_BASEMAP_STYLE). */
export type MapBasemapMode = "openfreemap" | "carto" | "minimal";

const CARTO_DARK_TILES = [
  "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
  "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
  "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
  "https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
] as const;

/**
 * OpenFreeMap Dark — векторные тайлы OSM, публичный инстанс без API-ключа.
 * @see https://openfreemap.org/quick_start/
 */
export const MAP_BASEMAP_STYLE_URL_DEFAULT =
  "https://tiles.openfreemap.org/styles/dark";

/** OpenFreeMap Bright — светлая тема (positron-like). */
export const MAP_BASEMAP_STYLE_URL_LIGHT =
  "https://tiles.openfreemap.org/styles/bright";

const CARTO_LIGHT_TILES = [
  "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
  "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
  "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
  "https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
] as const;

/** Растровая подложка Carto Light (запасной режим `carto`, светлая тема). */
export const MAP_STYLE_CARTO_LIGHT = {
  version: 8 as const,
  name: "radar-carto-light",
  sources: {
    "carto-light": {
      type: "raster" as const,
      tiles: [...CARTO_LIGHT_TILES],
      tileSize: 512,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxzoom: 20,
    },
  },
  layers: [
    {
      id: "carto-light-raster",
      type: "raster" as const,
      source: "carto-light",
      minzoom: 0,
      maxzoom: 22,
    },
  ],
};

/**
 * Растровая подложка Carto Dark (запасной режим `carto`).
 * CDN cartocdn.com обычно доступен из РФ; данные © OSM © CARTO.
 */
export const MAP_STYLE_CARTO_DARK = {
  version: 8 as const,
  name: "radar-carto-dark",
  sources: {
    "carto-dark": {
      type: "raster" as const,
      tiles: [...CARTO_DARK_TILES],
      tileSize: 512,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxzoom: 20,
    },
  },
  layers: [
    {
      id: "carto-dark-raster",
      type: "raster" as const,
      source: "carto-dark",
      minzoom: 0,
      maxzoom: 22,
    },
  ],
};

/** Только тёмный фон, без внешних тайлов (режим `minimal`). */
export const MAP_STYLE_MINIMAL = {
  version: 8 as const,
  sources: {},
  layers: [
    {
      id: "background",
      type: "background" as const,
      paint: { "background-color": "#11141a" },
    },
  ],
};

/** Светлый фон без тайлов — fallback при недоступности CDN подложки. */
export const MAP_STYLE_MINIMAL_LIGHT = {
  version: 8 as const,
  sources: {},
  layers: [
    {
      id: "background",
      type: "background" as const,
      paint: { "background-color": "#e8eaed" },
    },
  ],
};

/** Inline-стиль без внешних тайлов — авто-fallback при ошибке загрузки подложки. */
export function resolveMapBasemapFallbackForTheme(
  theme: ThemeMode,
): typeof MAP_STYLE_MINIMAL | typeof MAP_STYLE_MINIMAL_LIGHT {
  return theme === "light" ? MAP_STYLE_MINIMAL_LIGHT : MAP_STYLE_MINIMAL;
}

function readBasemapMode(): MapBasemapMode {
  const raw = import.meta.env.VITE_MAP_BASEMAP_STYLE?.trim().toLowerCase();
  if (raw === "carto" || raw === "minimal" || raw === "openfreemap") {
    return raw;
  }
  return "openfreemap";
}

/**
 * URL векторного стиля подложки (OpenFreeMap или свой self-host).
 * Перекрывает режим по умолчанию, если задан явно.
 */
export function resolveMapBasemapStyleUrl(): string {
  const fromEnv = import.meta.env.VITE_MAP_BASEMAP_STYLE_URL?.trim();
  if (fromEnv) return fromEnv;
  return MAP_BASEMAP_STYLE_URL_DEFAULT;
}

/**
 * Стиль MapLibre для GeoMapWidget: URL векторной подложки или встроенный JSON.
 * @deprecated Используй resolveMapBasemapStyleForTheme(theme)
 */
export function resolveMapBasemapStyle(): string | typeof MAP_STYLE_CARTO_DARK | typeof MAP_STYLE_MINIMAL {
  const mode = readBasemapMode();
  if (mode === "carto") return MAP_STYLE_CARTO_DARK;
  if (mode === "minimal") return MAP_STYLE_MINIMAL;
  return resolveMapBasemapStyleUrl();
}

/**
 * Стиль MapLibre с учётом текущей темы приложения.
 * Для minimal — тема не влияет (нет внешних тайлов).
 */
export function resolveMapBasemapStyleForTheme(
  theme: ThemeMode,
): string | typeof MAP_STYLE_CARTO_DARK | typeof MAP_STYLE_CARTO_LIGHT | typeof MAP_STYLE_MINIMAL {
  const mode = readBasemapMode();
  if (mode === "minimal") return MAP_STYLE_MINIMAL;
  if (mode === "carto") return theme === "light" ? MAP_STYLE_CARTO_LIGHT : MAP_STYLE_CARTO_DARK;
  return theme === "light" ? MAP_BASEMAP_STYLE_URL_LIGHT : MAP_BASEMAP_STYLE_URL_DEFAULT;
}

/** @deprecated Используйте resolveMapBasemapStyle(); оставлено для совместимости импортов. */
export const MAP_STYLE = MAP_STYLE_MINIMAL;

export const MAP_INITIAL_VIEW = {
  /** MapLibre: [долгота, широта] — обзор европейской части РФ. */
  center: [37.6, 55.75] as [number, number],
  zoom: 4,
};

/** Inset-контур активного региона (отдельная геометрия, не line-offset). */
export const REGION_MAP_STROKE_WIDTH = 2.8;

/** Выделение региона по selectedRegion$ (кнопка «Контур на карте» и чипы в ленте). */
export const REGION_MAP_SELECTED_STROKE_WIDTH = 4.5;
export const REGION_MAP_SELECTED_FILL_OPACITY = 0.5;
export const REGION_MAP_SELECTION_HALO = "#ffffff";

/**
 * Яркость заливки на гео (× regionFadeFactor).
 * Регион — приглушённее, place/district — parity со схемой; контур всегда ≥ fill × STROKE_FILL_RATIO.
 */
export const GEO_MAP_STROKE_FILL_RATIO = 1.5;
export const GEO_MAP_REGION_FILL_OPACITY = 0.5;
export const GEO_MAP_PLACE_FILL_OPACITY = 1;

/** @deprecated используй GEO_MAP_PLACE_FILL_OPACITY */
export const GEO_MAP_FILL_OPACITY = GEO_MAP_PLACE_FILL_OPACITY;

/** Fallback line-opacity для слоёв (без fade — верхняя граница). */
export const GEO_MAP_REGION_STROKE_OPACITY = Math.min(
  1,
  GEO_MAP_REGION_FILL_OPACITY * GEO_MAP_STROKE_FILL_RATIO,
);
export const GEO_MAP_PLACE_STROKE_OPACITY = Math.min(
  1,
  GEO_MAP_PLACE_FILL_OPACITY * GEO_MAP_STROKE_FILL_RATIO,
);

/** @deprecated используй GEO_MAP_REGION_FILL_OPACITY */
export const REGION_MAP_FILL_OPACITY = GEO_MAP_REGION_FILL_OPACITY;

/** @deprecated используй GEO_MAP_PLACE_FILL_OPACITY */
export const DISTRICT_MAP_FILL_OPACITY = GEO_MAP_PLACE_FILL_OPACITY;

/** Сжатие полигона к центроиду для inset-контура (~0.4%). */
export const REGION_MAP_INSET_FACTOR = 0.996;

export const DISTRICT_MAP_STROKE_WIDTH = 1.5;
/** Минимальный zoom для показа полигонов районов (при мелком масштабе слишком мелко). */
export const DISTRICT_MAP_MIN_ZOOM = 6;

/** Радиус маркера place на карте: точка для district меньше, чтобы не перекрывать полигон. */
export const PLACE_CIRCLE_RADIUS_DEFAULT = 9;
export const PLACE_CIRCLE_RADIUS_DISTRICT = 6;

/** MapLibre: радиус place-маркера уменьшается на overview (anti-clump). */
export function placeCircleRadiusByZoom(): unknown[] {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    3,
    2,
    6,
    5,
    10,
    PLACE_CIRCLE_RADIUS_DEFAULT,
    14,
    12,
  ];
}

/** MapLibre: теплокарта raise-событий (heatmap + точки при zoom). */
export const EVENTS_HEATMAP_SOURCE = "events-heatmap";
export const EVENTS_HEATMAP_LAYER = "events-heatmap-layer";
export const EVENTS_HEATMAP_POINTS_LAYER = "events-heatmap-points";
/** Heatmap гаснет к этому zoom; кружки появляются с EVENTS_HEATMAP_ZOOM_POINTS_MIN. */
export const EVENTS_HEATMAP_ZOOM_HEAT_MAX = 9;
export const EVENTS_HEATMAP_ZOOM_POINTS_MIN = 7;

/**
 * Градиент density: растянутый переход, максимум — orange (без red).
 */
export function eventsHeatmapColorExpression(_theme: ThemeMode): unknown[] {
  return [
    "interpolate",
    ["linear"],
    ["heatmap-density"],
    0,
    "rgba(50, 50, 255, 0)",
    0.1,
    "rgba(0, 120, 200, 0.35)",
    0.22,
    "rgb(0, 180, 220)",
    0.38,
    "rgb(80, 200, 160)",
    0.52,
    "rgb(160, 220, 120)",
    0.66,
    "rgb(230, 230, 90)",
    0.8,
    "rgb(255, 190, 60)",
    0.92,
    LEVEL_COLORS.orange,
    1,
    LEVEL_COLORS.orange,
  ];
}

/** Heatmap на обзоре: intensity/radius по zoom и weight события. */
export function eventsHeatmapPaint(_theme: ThemeMode): Record<string, unknown> {
  return {
    "heatmap-weight": [
      "interpolate",
      ["linear"],
      ["coalesce", ["get", "weight"], 2],
      2,
      0.1,
      3,
      0.22,
      4,
      0.38,
    ],
    "heatmap-intensity": [
      "interpolate",
      ["linear"],
      ["zoom"],
      0,
      0.55,
      5,
      0.75,
      EVENTS_HEATMAP_ZOOM_HEAT_MAX,
      0.95,
    ],
    // heatmap-radius — только data-driven (weight); zoom в MapLibre 4.x здесь запрещён.
    "heatmap-radius": [
      "interpolate",
      ["linear"],
      ["coalesce", ["get", "weight"], 2],
      2,
      6,
      3,
      11,
      4,
      18,
    ],
    "heatmap-color": eventsHeatmapColorExpression(_theme),
    "heatmap-opacity": [
      "interpolate",
      ["linear"],
      ["zoom"],
      EVENTS_HEATMAP_ZOOM_POINTS_MIN,
      1,
      EVENTS_HEATMAP_ZOOM_HEAT_MAX,
      0,
    ],
  };
}

/** Точки-события при приближении (crossfade с heatmap). */
export function eventsHeatmapPointsPaint(_theme: ThemeMode): Record<string, unknown> {
  return {
    "circle-color": [
      "match",
      ["get", "stateLevel"],
      "red",
      LEVEL_COLORS.red,
      "orange",
      LEVEL_COLORS.orange,
      "yellow",
      LEVEL_COLORS.yellow,
      LEVEL_COLORS.yellow,
    ],
    "circle-stroke-color": "#ffffff",
    "circle-stroke-width": 1,
    "circle-radius": [
      "interpolate",
      ["linear"],
      ["zoom"],
      EVENTS_HEATMAP_ZOOM_POINTS_MIN,
      [
        "interpolate",
        ["linear"],
        ["coalesce", ["get", "weight"], 1],
        1,
        4,
        2,
        6,
        3,
        8,
        4,
        10,
      ],
      14,
      [
        "interpolate",
        ["linear"],
        ["coalesce", ["get", "weight"], 1],
        1,
        8,
        2,
        12,
        3,
        16,
        4,
        20,
      ],
    ],
    "circle-opacity": [
      "interpolate",
      ["linear"],
      ["zoom"],
      EVENTS_HEATMAP_ZOOM_POINTS_MIN,
      0,
      EVENTS_HEATMAP_ZOOM_POINTS_MIN + 1,
      1,
    ],
  };
}
