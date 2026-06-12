import { BehaviorSubject } from "rxjs";

/** Идёт загрузка districts-active GeoJSON. */
export const districtsGeoLoading$ = new BehaviorSubject<boolean>(false);

/** Текст последней ошибки districts-active (null — ок). */
export const districtsGeoError$ = new BehaviorSubject<string | null>(null);

export function setDistrictsGeoLoading(loading: boolean): void {
  districtsGeoLoading$.next(loading);
}

export function setDistrictsGeoError(message: string | null): void {
  districtsGeoError$.next(message);
}
