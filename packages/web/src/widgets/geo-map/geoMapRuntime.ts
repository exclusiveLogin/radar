import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { SourceMessage } from "@radar/shared";
import { mapApi } from "../../shared/api/mapApi";
import { isRegionVisibleOnMap } from "../../shared/state/derivations";
import { regionsByCode$ } from "../../shared/state/mapStore";
import { geoJsonFingerprint, paintRegionInsetOutlines } from "./geoMapPaint";
import { REGIONS_OUTLINE_SOURCE, REGIONS_SOURCE } from "./geoMapLayerIds";
import type { GeoJsonCollection } from "./geoMapTypes";

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
export function whenStyleReady(map: MapLibreMap, fn: () => void): void {
  if (map.isStyleLoaded()) {
    fn();
    return;
  }
  const onStyleData = (): void => {
    if (!map.isStyleLoaded()) return;
    map.off("styledata", onStyleData);
    fn();
  };
  map.on("styledata", onStyleData);
}

export type GeoMapRuntime = ReturnType<typeof createGeoMapRuntime>;

/**
 * Runtime карты (план A): сгруппированное mutable-состояние одного инстанса GeoMapWidget.
 * sources — push GeoJSON в MapLibre; regions — кеш repaint; popups — LRU; selection — feature-state.
 */
export function createGeoMapRuntime(host: GeoMapRuntimeHost) {
  const fingerprints = new Map<string, string>();
  let regionsPaintFingerprint = "";

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
      map.triggerRepaint();
      return true;
    },

    apply(sourceId: string, data: unknown): void {
      const map = host.getMap();
      if (!map) return;

      const push = (): boolean => sources.set(sourceId, data);
      whenStyleReady(map, () => {
        if (push()) return;
        map.once("idle", push);
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
      map.triggerRepaint();
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
        if (push()) {
          onCommitted();
          return;
        }
        map.once("idle", () => {
          if (push()) onCommitted();
        });
      });
    },

    invalidateRegions(): void {
      fingerprints.delete(REGIONS_SOURCE);
      fingerprints.delete(REGIONS_OUTLINE_SOURCE);
    },

    clear(): void {
      fingerprints.clear();
    },
  };

  const regions = {
    buildPaintFingerprint(now: number): string {
      const fadeBucket = Math.floor(now / 60_000);
      const parts: string[] = [];
      for (const [code, region] of regionsByCode$.value) {
        if (!isRegionVisibleOnMap(region)) continue;
        parts.push(`${code}:${region.stateLevel}:${region.statusEventAt ?? ""}:${fadeBucket}`);
      }
      parts.sort();
      return parts.join("|");
    },

    shouldSkipPaint(fingerprint: string, force: boolean): boolean {
      return !force && fingerprint === regionsPaintFingerprint;
    },

    markPainted(fingerprint: string): void {
      regionsPaintFingerprint = fingerprint;
    },

    resetPaintCache(): void {
      regionsPaintFingerprint = "";
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
    regions.resetPaintCache();
    popups.clear();
  }

  return { sources, regions, popups, selection, dispose };
}
