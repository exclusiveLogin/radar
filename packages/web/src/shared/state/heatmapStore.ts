import { BehaviorSubject } from "rxjs";
import type { EventHeatmapMeta, EventHeatmapPeriod } from "@radar/shared";

/** Пресет окна выборки событий. */
export const heatmapPeriod$ = new BehaviorSubject<EventHeatmapPeriod>("24h");

/** Мета последней успешной выборки (count, since/until). */
export const heatmapMeta$ = new BehaviorSubject<EventHeatmapMeta | null>(null);

export function setHeatmapPeriod(period: EventHeatmapPeriod): void {
  heatmapPeriod$.next(period);
}

export function setHeatmapMeta(meta: EventHeatmapMeta | null): void {
  heatmapMeta$.next(meta);
}
