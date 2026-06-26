import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { animationFrames, timer, type Subscription } from "rxjs";
import { take } from "rxjs/operators";
import type { SourceMessage } from "@radar/shared";
import { resolveMapBasemapFallbackForTheme } from "../../shared/config/mapConfig.service";
import { mapApi } from "../../shared/api/mapApi";
import type { ThemeMode } from "../../shared/state/themeStore";
import { geoJsonFingerprint, paintRegionInsetOutlines } from "./geoMapPaint";
import { REGIONS_OUTLINE_SOURCE, REGIONS_SOURCE } from "./geoMapLayerIds";
import type { GeoJsonCollection } from "./geoMapTypes";

/** Таймаут ожидания внешнего стиля перед переходом на inline-fallback. */
const MAP_STYLE_LOAD_TIMEOUT_MS = 5_000;


/** Повтор push в источник: rAF + idle/sourcedata — источник может появиться после addLayer. */
function retrySourcePush(
  map: MapLibreMap,
  push: () => boolean,
  onCommitted?: () => void,
): void {
  let settled = false;
  let frameSub: Subscription | undefined;

  const onIdle = (): void => {
    attempt();
  };
  const onSourceData = (event: { isSourceLoaded?: boolean }): void => {
    if (event.isSourceLoaded) attempt();
  };

  function cleanup(): void {
    frameSub?.unsubscribe();
    map.off("idle", onIdle);
    map.off("sourcedata", onSourceData);
  }

  function attempt(): boolean {
    if (settled || !push()) return settled;
    settled = true;
    onCommitted?.();
    cleanup();
    return true;
  }

  if (attempt()) return;

  let frameAttempts = 0;
  frameSub = animationFrames().subscribe(() => {
    attempt();
    if (!settled && ++frameAttempts >= 60) cleanup();
  });

  map.on("idle", onIdle);
  map.on("sourcedata", onSourceData);
}

/** Доступ к MapLibre-инстансу из closure useEffect. */
export type GeoMapRuntimeHost = {
  getMap(): MapLibreMap | null;
  isDisposed(): boolean;
};

/** LRU-кэш popup raw-сообщений place. */
class LruCache<K, V> {
  private readonly maxSize: number;
  private readonly map = new Map<K, V>();

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }
}

/** Выполняет fn, когда стиль MapLibre готов (иначе setData теряется). */
/**
 * Выполняет fn, когда стиль MapLibre полностью готов.
 * Слушает styledata + load + idle: после загрузки глифов symbol-слоя MapLibre
 * бросает idle (а не styledata), поэтому без него колбэки зависают навсегда.
 */
export function whenStyleReady(map: MapLibreMap, fn: () => void): void {
  if (map.isStyleLoaded()) {
    fn();
    return;
  }
  let done = false;
  const run = (): void => {
    if (done || !map.isStyleLoaded()) return;
    done = true;
    map.off("styledata", onEvent);
    map.off("load", onEvent);
    map.off("idle", onEvent);
    fn();
  };
  const onEvent = (): void => run();
  map.on("styledata", onEvent);
  map.on("load", onEvent);
  map.on("idle", onEvent);
}

export type WireMapBootstrapOptions = {
  map: MapLibreMap;
  theme: ThemeMode;
  onReady: () => void;
  isDisposed: () => boolean;
};

/**
 * Поднимает оверлеи, когда стиль готов — не ждём успешной загрузки тайлов.
 * При недоступности CDN подложки переключается на inline minimal style.
 */
export function wireMapBootstrap(opts: WireMapBootstrapOptions): () => void {
  let bootstrapped = false;
  let fallbackApplied = false;

  const bootstrap = (): void => {
    if (bootstrapped || opts.isDisposed()) return;
    if (!opts.map.isStyleLoaded()) return;
    bootstrapped = true;
    opts.onReady();
  };

  const scheduleBootstrap = (): void => {
    whenStyleReady(opts.map, bootstrap);
  };

  const applyFallback = (): void => {
    if (fallbackApplied || bootstrapped || opts.isDisposed()) return;
    fallbackApplied = true;
    opts.map.setStyle(resolveMapBasemapFallbackForTheme(opts.theme) as never);
    scheduleBootstrap();
  };

  const onError = (): void => {
    if (bootstrapped || opts.isDisposed()) return;
    // Ошибка отдельного тайла — стиль уже есть, оверлеи можно поднимать.
    if (opts.map.isStyleLoaded()) {
      scheduleBootstrap();
      return;
    }
    applyFallback();
  };

  opts.map.on("load", scheduleBootstrap);
  opts.map.on("styledata", scheduleBootstrap);
  opts.map.on("error", onError);

  const timeoutSub = timer(MAP_STYLE_LOAD_TIMEOUT_MS).pipe(take(1)).subscribe(() => {
    if (bootstrapped || opts.isDisposed()) return;
    if (opts.map.isStyleLoaded()) {
      scheduleBootstrap();
      return;
    }
    applyFallback();
  });

  return () => {
    timeoutSub.unsubscribe();
    opts.map.off("load", scheduleBootstrap);
    opts.map.off("styledata", scheduleBootstrap);
    opts.map.off("error", onError);
  };
}

export type GeoMapRuntime = ReturnType<typeof createGeoMapRuntime>;

/**
 * Runtime карты (план A): сгруппированное mutable-состояние одного инстанса GeoMapWidget.
 * sources — push GeoJSON в MapLibre; regions — кеш repaint; popups — LRU; selection — feature-state.
 */
export function createGeoMapRuntime(host: GeoMapRuntimeHost) {
  const fingerprints = new Map<string, string>();

  /**
   * Форсирует перерисовку после setData. Детерминированно, без гонок:
   * - resize() — ТОЛЬКО когда реально разъехался размер канваса и контейнера
   *   (иначе resize churn сбрасывает GL-буфер/коллизии символов → мигание слоёв);
   * - triggerRepaint() — всегда: штатный способ MapLibre отрисовать новый кадр.
   */
  const refreshMapViewport = (): void => {
    const map = host.getMap();
    if (!map || host.isDisposed()) return;
    const canvas = map.getCanvas();
    const container = map.getContainer();
    const sizeDrifted =
      canvas.clientWidth !== container.clientWidth
      || canvas.clientHeight !== container.clientHeight;
    if (sizeDrifted) {
      try {
        map.resize();
      } catch {
        // карта уже уничтожена
      }
    }
    map.triggerRepaint();
  };

  const sources = {
    set(sourceId: string, data: unknown): boolean {
      const map = host.getMap();
      if (!map) return false;

      const fingerprint = geoJsonFingerprint(data);
      if (fingerprints.get(sourceId) === fingerprint) return true;

      const source = map.getSource(sourceId) as GeoJSONSource | undefined;
      if (!source) return false;

      source.setData(data as never);
      fingerprints.set(sourceId, fingerprint);
      refreshMapViewport();
      return true;
    },

    apply(sourceId: string, data: unknown): void {
      const map = host.getMap();
      if (!map) return;

      const push = (): boolean => sources.set(sourceId, data);
      whenStyleReady(map, () => {
        retrySourcePush(map, push);
      });
    },

    commitRegions(painted: GeoJsonCollection, force: boolean): boolean {
      const map = host.getMap();
      if (!map) return false;

      const outlineData = paintRegionInsetOutlines(painted);
      const fingerprint = geoJsonFingerprint(painted);
      if (
        !force
        && fingerprints.get(REGIONS_SOURCE) === fingerprint
        && fingerprints.get(REGIONS_OUTLINE_SOURCE) === fingerprint
      ) {
        return true;
      }

      const fillSource = map.getSource(REGIONS_SOURCE) as GeoJSONSource | undefined;
      const outlineSource = map.getSource(REGIONS_OUTLINE_SOURCE) as GeoJSONSource | undefined;
      if (!fillSource || !outlineSource) return false;

      fillSource.setData(painted as never);
      outlineSource.setData(outlineData as never);
      fingerprints.set(REGIONS_SOURCE, fingerprint);
      fingerprints.set(REGIONS_OUTLINE_SOURCE, fingerprint);
      refreshMapViewport();
      return true;
    },

    pushRegions(
      painted: GeoJsonCollection,
      force: boolean,
      onCommitted: () => void,
    ): void {
      const map = host.getMap();
      if (!map) return;

      const push = (): boolean => sources.commitRegions(painted, force);
      whenStyleReady(map, () => {
        retrySourcePush(map, push, onCommitted);
      });
    },

    invalidateRegions(): void {
      fingerprints.delete(REGIONS_SOURCE);
      fingerprints.delete(REGIONS_OUTLINE_SOURCE);
    },

    /** Сброс отпечатка источника — принудительный setData при 0→N features. */
    clearFingerprint(sourceId: string): void {
      fingerprints.delete(sourceId);
    },

    clear(): void {
      fingerprints.clear();
    },
  };

  const popups = {
    sourceCache: new LruCache<string, SourceMessage | null>(80),
    sourcePending: new Map<string, Promise<SourceMessage | null>>(),

    clear(): void {
      this.sourceCache.clear();
      this.sourcePending.clear();
    },

    async resolvePlaceSource(placeId: string): Promise<SourceMessage | null> {
      if (popups.sourceCache.has(placeId)) {
        return popups.sourceCache.get(placeId) ?? null;
      }

      let pending = popups.sourcePending.get(placeId);
      if (!pending) {
        pending = mapApi
          .placeSourceMessage(placeId)
          .then((response) => response.message)
          .catch(() => null);
        popups.sourcePending.set(placeId, pending);
      }

      const message = await pending;
      popups.sourceCache.set(placeId, message);
      popups.sourcePending.delete(placeId);
      return message;
    },

    /** Raw winner-сообщение региона (по statusEventAt с карты). */
    async resolveRegionSource(
      regionCode: string,
      statusEventAt?: string,
    ): Promise<SourceMessage | null> {
      const cacheKey = `${regionCode}:${statusEventAt ?? ""}`;
      if (popups.sourceCache.has(cacheKey)) {
        return popups.sourceCache.get(cacheKey) ?? null;
      }

      let pending = popups.sourcePending.get(cacheKey);
      if (!pending) {
        pending = mapApi
          .regionSourceMessage(regionCode, statusEventAt ? { statusEventAt } : undefined)
          .then((response) => response.message)
          .catch(() => null);
        popups.sourcePending.set(cacheKey, pending);
      }

      const message = await pending;
      popups.sourceCache.set(cacheKey, message);
      popups.sourcePending.delete(cacheKey);
      return message;
    },
  };

  const selection = {
    setRegionSelected(regionCode: string, selected: boolean): void {
      const map = host.getMap();
      if (!map) return;
      for (const source of [REGIONS_SOURCE, REGIONS_OUTLINE_SOURCE]) {
        try {
          map.setFeatureState({ source, id: regionCode }, { selected });
        } catch {
          // регион ещё не в источнике
        }
      }
    },

    apply(prev: string | null, next: string | null): void {
      if (prev && prev !== next) selection.setRegionSelected(prev, false);
      if (next) selection.setRegionSelected(next, true);
    },
  };

  function dispose(): void {
    sources.clear();
    popups.clear();
  }

  return {
    sources,
    popups,
    selection,
    /**
     * Единая точка перерисовки для всех слоёв: resize ТОЛЬКО при реальном
     * расхождении размера канваса/контейнера + triggerRepaint. Используется
     * вместо «голого» map.resize(), который churn-ит GL-буфер и мигает символы.
     */
    repaint: refreshMapViewport,
    dispose,
  };
}
