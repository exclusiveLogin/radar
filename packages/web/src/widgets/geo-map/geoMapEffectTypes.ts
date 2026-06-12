import type { EventHeatmapResponse } from "@radar/shared";
import type { GeoJsonCollection } from "./geoMapTypes";

/** Фазы HTTP-запроса — один union, из него режутся loading/data/error потоки. */
export type FetchPhase<T> =
  | { phase: "loading" }
  | { phase: "success"; data: T }
  | { phase: "error"; error: unknown };

/** Успешный ответ теплокарты. */
export type HeatmapFetchData = EventHeatmapResponse;

/** Успешный ответ districts-active. */
export type DistrictsFetchData = GeoJsonCollection;
