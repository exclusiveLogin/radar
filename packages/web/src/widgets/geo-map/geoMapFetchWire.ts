import type { Subscription } from "rxjs";
import { takeUntil } from "rxjs/operators";
import type { Subject } from "rxjs";
import { pushAppLog, reportAppError } from "../../shared/state/appLogStore";
import {
  patchGeoMapLayerFetchStatus,
  type GeoMapFetchLayerId,
} from "../../shared/state/geoMapLayerFetchStore";
import type { FetchStreams } from "./geoMapRx";

const LAYER_LABELS: Record<GeoMapFetchLayerId, string> = {
  regions: "Регионы",
  districts: "Районы",
  heatmap: "Теплокарта",
};

function formatFetchError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** Подключает loading/data/error FetchStreams к per-layer fetch-store и log overlay. */
export function wireLayerFetchStreams<T>(options: {
  sub: Subscription;
  destroy$: Subject<void>;
  layerId: GeoMapFetchLayerId;
  streams: FetchStreams<T>;
  fallbackError: string;
  onData: (data: T) => void;
}): void {
  const { sub, destroy$, layerId, streams, fallbackError, onData } = options;
  const label = LAYER_LABELS[layerId];

  sub.add(
    streams.loading$.pipe(takeUntil(destroy$)).subscribe((loading) => {
      patchGeoMapLayerFetchStatus(layerId, { loading });
      if (loading) {
        pushAppLog("info", "Загрузка…", { source: label });
      }
    }),
  );

  sub.add(
    streams.error$.pipe(takeUntil(destroy$)).subscribe((error) => {
      const message = formatFetchError(error, fallbackError);
      patchGeoMapLayerFetchStatus(layerId, { error: message });
      reportAppError(label, error, fallbackError);
    }),
  );

  sub.add(
    streams.data$.pipe(takeUntil(destroy$)).subscribe((data) => {
      patchGeoMapLayerFetchStatus(layerId, { error: null, loading: false });
      const detail =
        layerId === "heatmap"
          ? "точек загружено"
          : `features: ${(data as { features?: unknown[] }).features?.length ?? "?"}`;
      pushAppLog("info", `Загружено (${detail})`, { source: label });
      onData(data);
    }),
  );
}
