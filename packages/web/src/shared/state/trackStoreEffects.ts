/**
 * RxJS-эффекты загрузки треков: слои карты + asOf → REST fetch → trackStore.
 */
import { combineLatest, EMPTY, from } from "rxjs";
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  finalize,
  switchMap,
  tap,
} from "rxjs/operators";
import { adminApi } from "../api/adminApi";
import { mapApi } from "../api/mapApi";
import { reportAppError } from "./appLogStore";
import { resolveTracksPipelineActive } from "./tracksPipelineActive";
import { geoMapLayers$ } from "./mapLayerStore";
import { historicalAsOf$ } from "./mapStore";
import {
  resetTrackStore,
  trackThreatProfileFilter$,
  tracksFlow$,
  tracksGravity$,
  tracksList$,
  tracksLoading$,
  tracksPipelineActive$,
  tracksRevision$,
} from "./trackStore";

let started = false;

export function startTrackStoreEffects(): void {
  if (started) return;
  started = true;

  combineLatest([
    geoMapLayers$.pipe(
      distinctUntilChanged(
        (a, b) =>
          a.tracks === b.tracks
          && a.tracksMotion === b.tracksMotion
          && a.locusDebug === b.locusDebug,
      ),
    ),
    historicalAsOf$.pipe(distinctUntilChanged()),
    trackThreatProfileFilter$.pipe(distinctUntilChanged()),
    tracksRevision$.pipe(distinctUntilChanged()),
  ])
    .pipe(
      debounceTime(1500),
      switchMap(([layers, asOf, threatProfile]) => {
        if (!layers.tracks && !layers.tracksMotion && !layers.locusDebug) {
          tracksList$.next(null);
          return EMPTY;
        }
        if (asOf != null) {
          return EMPTY;
        }
        tracksLoading$.next(true);
        const needsNodes = layers.tracks || layers.tracksMotion || layers.locusDebug;
        return from(
          mapApi.tracksList({
            asOf: asOf ?? undefined,
            threatProfile,
            limit: 1500,
            includeNodes: needsNodes,
          }),
        ).pipe(
          tap(data => tracksList$.next(data)),
          catchError(err => {
            reportAppError("Треки", err);
            tracksList$.next(null);
            return EMPTY;
          }),
          finalize(() => tracksLoading$.next(false)),
        );
      }),
    )
    .subscribe();

  combineLatest([
    geoMapLayers$.pipe(distinctUntilChanged((a, b) => a.tracksFlow === b.tracksFlow)),
    historicalAsOf$.pipe(distinctUntilChanged()),
    trackThreatProfileFilter$.pipe(distinctUntilChanged()),
    tracksRevision$.pipe(distinctUntilChanged()),
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

  combineLatest([
    geoMapLayers$.pipe(distinctUntilChanged((a, b) => a.tracksGravity === b.tracksGravity)),
    historicalAsOf$.pipe(distinctUntilChanged()),
    trackThreatProfileFilter$.pipe(distinctUntilChanged()),
    tracksRevision$.pipe(distinctUntilChanged()),
  ])
    .pipe(
      debounceTime(200),
      switchMap(([layers, asOf, threatProfile]) => {
        if (!layers.tracksGravity) {
          tracksGravity$.next(null);
          return EMPTY;
        }
        return from(
          mapApi.tracksGravity({
            asOf: asOf ?? undefined,
            threatProfile,
            geohashPrecision: 5,
          }),
        ).pipe(
          tap(data => tracksGravity$.next(data)),
          catchError(err => {
            reportAppError("Gravity треков", err);
            tracksGravity$.next(null);
            return EMPTY;
          }),
        );
      }),
    )
    .subscribe();

  historicalAsOf$.pipe(distinctUntilChanged()).subscribe(() => resetTrackStore());

  combineLatest([
    geoMapLayers$.pipe(
      distinctUntilChanged(
        (a, b) => a.tracks === b.tracks && a.tracksMotion === b.tracksMotion,
      ),
    ),
    tracksRevision$.pipe(distinctUntilChanged()),
  ])
    .pipe(
      debounceTime(2000),
      switchMap(([layers]) => {
        if (!layers.tracks && !layers.tracksMotion) {
          tracksPipelineActive$.next(false);
          return EMPTY;
        }
        return from(adminApi.trackingGetStatus()).pipe(
          tap(status => tracksPipelineActive$.next(resolveTracksPipelineActive(status))),
          catchError(err => {
            reportAppError("Статус tracking", err);
            tracksPipelineActive$.next(false);
            return EMPTY;
          }),
        );
      }),
    )
    .subscribe();
}
