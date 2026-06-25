/**
 * SSOT состояния треков на фронте:
 * - список треков (L1 summary)
 * - выбранный трек (для карточки)
 * - данные flow-коридоров (L2)
 *
 * Lifecycle жёстко привязан к historicalAsOf$ — при смене replay/live
 * данные сбрасываются и запрашиваются заново.
 */
import { BehaviorSubject } from "rxjs";
import type { TracksListResponse, TracksFlowResponse } from "@radar/shared";

/** Список треков (summary без нод). */
export const tracksList$ = new BehaviorSubject<TracksListResponse | null>(null);

/** ID выбранного трека (для открытия карточки). null — ничего не выбрано. */
export const selectedTrackId$ = new BehaviorSubject<string | null>(null);

/** Flow-коридоры (L2 rollup GeoJSON). */
export const tracksFlow$ = new BehaviorSubject<TracksFlowResponse | null>(null);

/** Загрузка списка треков в процессе. */
export const tracksLoading$ = new BehaviorSubject<boolean>(false);

/** Фильтр профиля угрозы — undefined означает "все". */
export const trackThreatProfileFilter$ = new BehaviorSubject<
  "uav" | "rocket" | "balloon" | "unknown" | undefined
>(undefined);

/** Выбрать трек (открывает карточку). */
export function selectTrack(id: string | null): void {
  selectedTrackId$.next(id);
}

/** Установить фильтр профиля для треков и flow. */
export function setTrackThreatProfileFilter(
  profile: "uav" | "rocket" | "balloon" | "unknown" | undefined,
): void {
  trackThreatProfileFilter$.next(profile);
}

/** Сбросить всё состояние треков (при смене live/replay). */
export function resetTrackStore(): void {
  tracksList$.next(null);
  selectedTrackId$.next(null);
  tracksFlow$.next(null);
  tracksLoading$.next(false);
}
