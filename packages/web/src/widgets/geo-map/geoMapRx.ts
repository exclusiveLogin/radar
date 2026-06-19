import {
  type Observable,
  concat,
  defer,
  from,
  of,
} from "rxjs";
import {
  catchError,
  distinctUntilChanged,
  filter,
  map,
  shareReplay,
} from "rxjs/operators";
import type { FetchPhase } from "./geoMapEffectTypes";

/** Оборачивает Promise в поток фаз loading → success | error. */
export function toFetchPhase$<T>(request: () => Promise<T>): Observable<FetchPhase<T>> {
  return concat(
    of<FetchPhase<T>>({ phase: "loading" }),
    defer(() => from(request())).pipe(
      map((data): FetchPhase<T> => ({ phase: "success", data })),
      catchError((error): Observable<FetchPhase<T>> => of({ phase: "error", error })),
    ),
  );
}

export type FetchStreams<T> = {
  loading$: Observable<boolean>;
  data$: Observable<T>;
  error$: Observable<unknown>;
};

/** Разделяет FetchPhase на loading / data / error с shareReplay + refCount. */
export function splitFetchPhase$<T>(source$: Observable<FetchPhase<T>>): FetchStreams<T> {
  const shared$ = source$.pipe(shareReplay({ bufferSize: 1, refCount: true }));

  return {
    loading$: shared$.pipe(
      map((event) => event.phase === "loading"),
      distinctUntilChanged(),
    ),
    data$: shared$.pipe(
      filter((event): event is { phase: "success"; data: T } => event.phase === "success"),
      map((event) => event.data),
    ),
    error$: shared$.pipe(
      filter((event): event is { phase: "error"; error: unknown } => event.phase === "error"),
      map((event) => event.error),
    ),
  };
}
