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
 * Полупрозрачная заливка региона (субъект = нижний слой, темнее/тусклее районов).
 * Районы рисуются выше с большей непрозрачностью → субъект = «подложка», район = «маркер».
 */
export const REGION_MAP_FILL_OPACITY = 0.18;

/** Сжатие полигона к центроиду для inset-контура (~0.4%). */
export const REGION_MAP_INSET_FACTOR = 0.996;

/** Полигон района (district/city_district) — выше региона, насыщеннее. */
export const DISTRICT_MAP_FILL_OPACITY = 0.35;
export const DISTRICT_MAP_STROKE_WIDTH = 1.5;
/** Минимальный zoom для показа полигонов районов (при мелком масштабе слишком мелко). */
export const DISTRICT_MAP_MIN_ZOOM = 6;

/** Радиус маркера place на карте: точка для district меньше, чтобы не перекрывать полигон. */
export const PLACE_CIRCLE_RADIUS_DEFAULT = 9;
export const PLACE_CIRCLE_RADIUS_DISTRICT = 6;
