/**
 * RxJS-эффекты загрузки треков: слои карты + asOf → REST fetch → trackStore.
 */
import { combineLatest, EMPTY, from } from "rxjs";
import { catchError, debounceTime, distinctUntilChanged, switchMap, tap } from "rxjs/operators";
import { mapApi } from "../api/mapApi";
import { reportAppError } from "./appLogStore";
import { geoMapLayers$ } from "./mapLayerStore";
import { historicalAsOf$ } from "./mapStore";
import {
  resetTrackStore,
  trackThreatProfileFilter$,
  tracksFlow$,
  tracksList$,
  tracksLoading$,
} from "./trackStore";

let started = false;

export function startTrackStoreEffects(): void {
  if (started) return;
  started = true;

  combineLatest([
    geoMapLayers$.pipe(distinctUntilChanged((a, b) => a.tracks === b.tracks)),
    historicalAsOf$.pipe(distinctUntilChanged()),
    trackThreatProfileFilter$.pipe(distinctUntilChanged()),
  ])
    .pipe(
      debounceTime(200),
      switchMap(([layers, asOf, threatProfile]) => {
        if (!layers.tracks) {
          tracksList$.next(null);
          return EMPTY;
        }
        tracksLoading$.next(true);
        return from(
          mapApi.tracksList({
            asOf: asOf ?? undefined,
            threatProfile,
            limit: 500,
            includeNodes: true,
          }),
        ).pipe(
          tap(data => tracksList$.next(data)),
          catchError(err => {
            reportAppError("Треки", err);
            tracksList$.next(null);
            return EMPTY;
          }),
          tap(() => tracksLoading$.next(false)),
        );
      }),
    )
    .subscribe();

  combineLatest([
    geoMapLayers$.pipe(distinctUntilChanged((a, b) => a.tracksFlow === b.tracksFlow)),
    historicalAsOf$.pipe(distinctUntilChanged()),
    trackThreatProfileFilter$.pipe(distinctUntilChanged()),
  ])
    .pipe(
      debounceTime(200),
      switchMap(([layers, asOf, threatProfile]) => {
        if (!layers.tracksFlow) {
          tracksFlow$.next(null);
          return EMPTY;
        }
        return from(
          mapApi.tracksFlow({
            asOf: asOf ?? undefined,
            threatProfile,
            minCount: 2,
            limit: 200,
          }),
        ).pipe(
          tap(data => tracksFlow$.next(data)),
          catchError(err => {
            reportAppError("Flow треков", err);
            tracksFlow$.next(null);
            return EMPTY;
          }),
        );
      }),
    )
    .subscribe();

  historicalAsOf$.pipe(distinctUntilChanged()).subscribe(() => resetTrackStore());
}
