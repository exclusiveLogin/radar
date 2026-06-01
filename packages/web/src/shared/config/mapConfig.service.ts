import type { StateLevel } from "@radar/shared";

/**
 * Конфиг карты и темы: SSOT цветов уровней состояния (используется и схемой, и MapLibre, и бейджами).
 * Доменная семантика уровней — в shared; здесь только визуальное представление.
 */
export const LEVEL_COLORS: Record<StateLevel, string> = {
  grey: "#3a3f4b",
  green: "#3ba55d",
  yellow: "#d4b106",
  orange: "#e8770e",
  red: "#e23b3b",
};

export const LEVEL_LABELS: Record<StateLevel, string> = {
  grey: "Нет данных",
  green: "Отбой",
  yellow: "Внимание",
  orange: "Повышенная опасность",
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
 * Не использует tile.openstreetmap.org (часто недоступен из РФ).
 * @see https://openfreemap.org/quick_start/
 */
export const MAP_BASEMAP_STYLE_URL_DEFAULT =
  "https://tiles.openfreemap.org/styles/dark";

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
 */
export function resolveMapBasemapStyle(): string | typeof MAP_STYLE_CARTO_DARK | typeof MAP_STYLE_MINIMAL {
  const mode = readBasemapMode();
  if (mode === "carto") return MAP_STYLE_CARTO_DARK;
  if (mode === "minimal") return MAP_STYLE_MINIMAL;
  return resolveMapBasemapStyleUrl();
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

/** Полупрозрачная заливка региона тем же цветом, что и контур. */
export const REGION_MAP_FILL_OPACITY = 0.24;

/** Сжатие полигона к центроиду для inset-контура (~0.4%). */
export const REGION_MAP_INSET_FACTOR = 0.996;
