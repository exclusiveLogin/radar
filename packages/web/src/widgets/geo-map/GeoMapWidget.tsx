import { useEffect, useRef, useState } from "react";
import type { MapRegionSnapshot } from "@radar/shared";
import { Panel } from "../../shared/ds";
import {
  LEVEL_COLORS,
  MAP_INITIAL_VIEW,
  resolveMapBasemapStyle,
} from "../../shared/config/mapConfig.service";
import { regionsByCode$ } from "../../shared/state/mapStore";
import { selectRegion } from "../../shared/state/selectionStore";

const SOURCE_ID = "regions";
const LAYER_ID = "regions-circles";

/** GeoJSON точек из центроидов регионов с цветом уровня и размером по activity. */
function toFeatureCollection(regions: Map<string, MapRegionSnapshot>) {
  const features = [...regions.values()]
    .filter((region) => region.centroidLat != null && region.centroidLon != null)
    .map((region) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [region.centroidLon!, region.centroidLat!],
      },
      properties: {
        regionCode: region.regionCode,
        color: LEVEL_COLORS[region.stateLevel],
        activity: region.activity,
      },
    }));
  return { type: "FeatureCollection" as const, features };
}

/** Подгоняет камеру под набор точек (если есть что показывать). */
function fitToFeatures(
  map: import("maplibre-gl").Map,
  collection: ReturnType<typeof toFeatureCollection>,
): void {
  if (collection.features.length === 0) return;
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const feature of collection.features) {
    const [lon, lat] = feature.geometry.coordinates;
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  if (!Number.isFinite(minLon)) return;
  map.fitBounds(
    [
      [minLon, minLat],
      [maxLon, maxLat],
    ],
    { padding: 48, maxZoom: 6, duration: 0 },
  );
}

/**
 * Гео-виджет на MapLibre. Тяжёлая библиотека и стиль грузятся лениво (dynamic import)
 * — только когда виджет смонтирован. Регионы рисуются circle-слоем по центроидам.
 */
export function GeoMapWidget() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [pointCount, setPointCount] = useState(0);

  useEffect(() => {
    let map: import("maplibre-gl").Map | null = null;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;

    void (async () => {
      const maplibre = (await import("maplibre-gl")).default;
      await import("maplibre-gl/dist/maplibre-gl.css");
      if (disposed || !containerRef.current) return;

      map = new maplibre.Map({
        container: containerRef.current,
        style: resolveMapBasemapStyle() as never,
        center: MAP_INITIAL_VIEW.center,
        zoom: MAP_INITIAL_VIEW.zoom,
        attributionControl: { compact: true },
      });
      map.on("load", () => {
        if (!map) return;
        const applyRegions = (regions: Map<string, MapRegionSnapshot>): void => {
          const collection = toFeatureCollection(regions);
          setPointCount(collection.features.length);
          const source = map?.getSource(SOURCE_ID) as
            | import("maplibre-gl").GeoJSONSource
            | undefined;
          source?.setData(collection as never);
          if (collection.features.length > 0) fitToFeatures(map!, collection);
        };

        const initial = toFeatureCollection(regionsByCode$.value);
        map.addSource(SOURCE_ID, { type: "geojson", data: initial });
        map.addLayer({
          id: LAYER_ID,
          type: "circle",
          source: SOURCE_ID,
          paint: {
            "circle-color": ["get", "color"],
            "circle-radius": ["+", 6, ["*", 2, ["get", "activity"]]],
            "circle-stroke-color": "#0d0f14",
            "circle-stroke-width": 1,
            "circle-opacity": 0.85,
          },
        });

        map.on("click", LAYER_ID, (event) => {
          const code = event.features?.[0]?.properties?.regionCode;
          if (typeof code === "string") selectRegion(code);
        });

        applyRegions(regionsByCode$.value);
        unsubscribe = regionsByCode$.subscribe(applyRegions).unsubscribe;
      });
    })();

    return () => {
      disposed = true;
      unsubscribe?.();
      map?.remove();
    };
  }, []);

  return (
    <Panel title="Гео-карта" className="geo-map-panel">
      {pointCount === 0 ? (
        <p className="ds-muted geo-map-panel__hint">
          Нет регионов с координатами. Выполните{" "}
          <code>npm run geo:db:apply</code> после обновления кода.
        </p>
      ) : null}
      <div ref={containerRef} className="geo-map-panel__canvas" />
    </Panel>
  );
}
