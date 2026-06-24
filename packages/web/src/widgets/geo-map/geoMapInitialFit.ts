import {
  BehaviorSubject,
  combineLatest,
  forkJoin,
  of,
  type Observable,
  type Subject,
  type Subscription,
} from "rxjs";
import { filter, map, switchMap, take, takeUntil } from "rxjs/operators";
import { mapCanvasReady$ } from "../../shared/state/mapGeoPipeline";
import {
  enabledGeoMapCanvasLayers,
  geoMapLayers$,
  GEO_MAP_CANVAS_LAYER_ORDER,
  type GeoMapCanvasLayerId,
} from "../../shared/state/mapLayerStore";

/** Первый успешный paint (или skip) каждого canvas-слоя. */
const layerPainted$ = Object.fromEntries(
  GEO_MAP_CANVAS_LAYER_ORDER.map((id) => [id, new BehaviorSubject(false)]),
) as Record<GeoMapCanvasLayerId, BehaviorSubject<boolean>>;

/** SSOT: subject готовности слоя. */
function paintedSubject(id: GeoMapCanvasLayerId): BehaviorSubject<boolean> {
  return layerPainted$[id];
}

/** Слой отрисован (или пропущен как пустой) — сигнал для forkJoin initial fit. */
export function markGeoMapLayerPainted(id: GeoMapCanvasLayerId): void {
  const subject = paintedSubject(id);
  if (!subject.value) subject.next(true);
}

/** Сброс при unmount карты. */
export function resetGeoMapLayerPainted(): void {
  for (const subject of Object.values(layerPainted$)) {
    subject.next(false);
  }
}

function layerFirstPainted$(id: GeoMapCanvasLayerId): Observable<true> {
  const subject = paintedSubject(id);
  if (subject.value) return of(true as const);
  return subject.pipe(
    filter(Boolean),
    take(1),
    map(() => true as const),
  );
}

/**
 * Один раз: все включённые canvas-слои (из geoMapLayers$) отрисованы.
 * Набор слоёв не хардкодится — берётся из store (далее LS).
 */
export function allEnabledCanvasLayersPaintedOnce$(
  destroy$: Observable<void>,
): Observable<GeoMapCanvasLayerId[]> {
  return combineLatest([
    mapCanvasReady$.pipe(filter(Boolean), take(1)),
    geoMapLayers$.pipe(take(1)),
  ]).pipe(
    switchMap(([, layers]) => {
      const enabled = enabledGeoMapCanvasLayers(layers);
      if (enabled.length === 0) return of([]);
      return forkJoin(enabled.map((id) => layerFirstPainted$(id))).pipe(
        map(() => enabled),
      );
    }),
    take(1),
    takeUntil(destroy$),
  );
}

export type WireInitialGeoMapFitOptions = {
  destroy$: Subject<void>;
  shouldSkip: () => boolean;
  onAllLayersReady: (enabledLayers: GeoMapCanvasLayerId[]) => void;
};

/** Подписка auto-fit: forkJoin → callback → take(1) отписывает поток. */
export function wireInitialGeoMapFit(options: WireInitialGeoMapFitOptions): Subscription {
  return allEnabledCanvasLayersPaintedOnce$(options.destroy$).subscribe((enabled) => {
    if (options.shouldSkip()) return;
    options.onAllLayersReady(enabled);
  });
}
