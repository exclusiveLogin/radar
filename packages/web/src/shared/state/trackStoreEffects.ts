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
import type { TrackingStatusResponse } from "@radar/shared";
import type { TracksListResponse } from "@radar/shared";

let started = false;
let prevRebuildRunId: string | null = null;
const LIVE_TRACKS_STALE_GRACE_MS = 2 * 60_000;
const LIVE_TRACKS_MERGE_MAX = 3000;

/**
 * Полный сброс локального track-store нужен только при явном rebuild/reset.
 * Инкрементальный daemon (mode=incremental) не должен гасить уже видимые треки.
 */
function shouldResetTracksStoreForStatus(status: TrackingStatusResponse): boolean {
  const run = status.activeRun;
  const runId = run?.id ?? null;
  const isNewRun = runId != null && runId !== prevRebuildRunId;
  prevRebuildRunId = runId;
  if (!isNewRun || !run) return false;
  if (run.status !== "running") return false;
  return run.mode === "full_rebuild" || run.mode === "soft_rebuild";
}

function parseIsoMs(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Live anti-flicker: не теряем трек мгновенно, если его нет в одном snapshot
 * (limit/оконная гонка в момент записи). Исторический asOf не мержим.
 */
function mergeLiveTracksSnapshot(
  prev: TracksListResponse | null,
  incoming: TracksListResponse,
): TracksListResponse {
  if (!prev) return incoming;
  const keepAfterMs = Date.now() - LIVE_TRACKS_STALE_GRACE_MS;
  const byId = new Map(incoming.tracks.map(track => [track.id, track]));
  const merged = [...incoming.tracks];

  for (const track of prev.tracks) {
    if (byId.has(track.id)) continue;
    if (parseIsoMs(track.lastAt) < keepAfterMs) continue;
    merged.push(track);
  }

  merged.sort((a, b) => parseIsoMs(b.lastAt) - parseIsoMs(a.lastAt));
  const capped = merged.slice(0, LIVE_TRACKS_MERGE_MAX);
  return {
    tracks: capped,
    meta: {
      asOf: incoming.meta.asOf,
      count: capped.length,
    },
  };
}

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
          tap(data =>
            tracksList$.next(
              asOf == null
                ? mergeLiveTracksSnapshot(tracksList$.value, data)
                : data,
            )
          ),
          catchError(err => {
            reportAppError("Треки", err);
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
            return EMPTY;
          }),
        );
      }),
    )
    .subscribe();

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
          tap(status => {
            if (shouldResetTracksStoreForStatus(status)) {
              resetTrackStore();
            }
            tracksPipelineActive$.next(resolveTracksPipelineActive(status));
          }),
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
