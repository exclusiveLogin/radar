import { BehaviorSubject, combineLatest, map } from "rxjs";

/** Слои с HTTP-fetch на карте — отдельно от toggle видимости (geoMapLayers$). */
export const GEO_MAP_FETCH_LAYERS = ["regions", "districts", "heatmap"] as const;

export type GeoMapFetchLayerId = (typeof GEO_MAP_FETCH_LAYERS)[number];

/** Состояние загрузки слоя — зеркало FetchPhase loading/error. */
export type GeoMapLayerFetchStatus = {
  loading: boolean;
  error: string | null;
};

export const GEO_MAP_LAYER_FETCH_IDLE: GeoMapLayerFetchStatus = {
  loading: false,
  error: null,
};

/** Per-layer SSOT: loading + error без общего Record. */
export const regionsFetchStatus$ = new BehaviorSubject<GeoMapLayerFetchStatus>({
  ...GEO_MAP_LAYER_FETCH_IDLE,
});

export const districtsFetchStatus$ = new BehaviorSubject<GeoMapLayerFetchStatus>({
  ...GEO_MAP_LAYER_FETCH_IDLE,
});

export const heatmapFetchStatus$ = new BehaviorSubject<GeoMapLayerFetchStatus>({
  ...GEO_MAP_LAYER_FETCH_IDLE,
});

const FETCH_STATUS_BY_LAYER: Record<
  GeoMapFetchLayerId,
  BehaviorSubject<GeoMapLayerFetchStatus>
> = {
  regions: regionsFetchStatus$,
  districts: districtsFetchStatus$,
  heatmap: heatmapFetchStatus$,
};

/** Снимок всех fetch-статусов — одна подписка для MapLayersPanel. */
export const geoMapFetchStatuses$ = combineLatest({
  regions: regionsFetchStatus$,
  districts: districtsFetchStatus$,
  heatmap: heatmapFetchStatus$,
}).pipe(
  map((statuses) => statuses),
);

/** Частичное обновление fetch-статуса одного слоя. */
export function patchGeoMapLayerFetchStatus(
  layerId: GeoMapFetchLayerId,
  patch: Partial<GeoMapLayerFetchStatus>,
): void {
  const subject = FETCH_STATUS_BY_LAYER[layerId];
  subject.next({ ...subject.value, ...patch });
}

/** Сброс fetch-статуса слоя (hide layer / unmount). */
export function resetGeoMapLayerFetchStatus(layerId: GeoMapFetchLayerId): void {
  FETCH_STATUS_BY_LAYER[layerId].next({ ...GEO_MAP_LAYER_FETCH_IDLE });
}

export function resetAllGeoMapLayerFetchStatus(): void {
  for (const layerId of GEO_MAP_FETCH_LAYERS) {
    resetGeoMapLayerFetchStatus(layerId);
  }
}

/** Fetch-статус для строки панели слоёв; places/timeline — всегда idle. */
export function resolveGeoMapLayerFetchStatus(
  layerId: string,
  fetchStatuses: Record<GeoMapFetchLayerId, GeoMapLayerFetchStatus>,
): GeoMapLayerFetchStatus {
  if (layerId === "regions" || layerId === "districts" || layerId === "heatmap") {
    return fetchStatuses[layerId];
  }
  return GEO_MAP_LAYER_FETCH_IDLE;
}
