import { useEffect, useRef, useState } from "react";
import type { MapPlaceSnapshot, MapRegionSnapshot, StateLevel } from "@radar/shared";
import { Panel } from "../../shared/ds";
import { mapApi } from "../../shared/api/mapApi";
import {
  LEVEL_COLORS,
  MAP_INITIAL_VIEW,
  resolveMapBasemapStyle,
} from "../../shared/config/mapConfig.service";
import { placesById$, regionsByCode$ } from "../../shared/state/mapStore";
import { selectRegion } from "../../shared/state/selectionStore";

const REGIONS_SOURCE = "regions";
const REGIONS_OUTLINE = "regions-outline";
const PLACES_SOURCE = "places";
const PLACES_LAYER = "places-circles";

type PointFeature = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: Record<string, string | number>;
};

type PolygonFeature = {
  type: "Feature";
  id?: string;
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, string | number>;
};

type GeoJsonCollection = {
  type: "FeatureCollection";
  features: PolygonFeature[];
};

/**
 * Контуры регионов: только активные (≠ grey), цвет по stateLevel.
 * Базовая геометрия загружается один раз; при WS меняются только properties.
 */
function paintRegionOutlines(
  base: GeoJsonCollection,
  regions: Map<string, MapRegionSnapshot>,
): GeoJsonCollection {
  return {
    type: "FeatureCollection",
    features: base.features
      .map((feature) => {
        const code = String(feature.properties.regionCode ?? "");
        const region = regions.get(code);
        const stateLevel = (region?.stateLevel ?? "grey") as StateLevel;
        if (stateLevel === "grey") return null;
        return {
          ...feature,
          properties: {
            ...feature.properties,
            regionCode: code,
            stateLevel,
            color: LEVEL_COLORS[stateLevel],
            kind: "region",
          },
        };
      })
      .filter((feature): feature is PolygonFeature => feature !== null),
  };
}

/** Точки places (отдельный слой, без дублирования с регионами). */
function placesToFeatures(places: Map<string, MapPlaceSnapshot>): PointFeature[] {
  return [...places.values()].map((place) => ({
    type: "Feature" as const,
    geometry: {
      type: "Point" as const,
      coordinates: [place.lon, place.lat],
    },
    properties: {
      kind: "place",
      placeId: place.placeId,
      placeName: place.placeName,
      regionCode: place.regionCode,
      color: LEVEL_COLORS[place.stateLevel],
      radius: 9,
    },
  }));
}

/** Выполняет fn, когда стиль MapLibre готов (иначе setData теряется). */
function whenStyleReady(
  map: import("maplibre-gl").Map,
  fn: () => void,
): void {
  if (map.isStyleLoaded()) {
    fn();
    return;
  }
  map.once("load", fn);
}

function placesCollection(places: Map<string, MapPlaceSnapshot>) {
  return { type: "FeatureCollection" as const, features: placesToFeatures(places) };
}

function fitMapView(
  map: import("maplibre-gl").Map,
  regionFeatures: PolygonFeature[],
  placeFeatures: PointFeature[],
): void {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  const extend = (lon: number, lat: number): void => {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  };

  const walkCoords = (coords: unknown): void => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      extend(coords[0], coords[1]);
      return;
    }
    for (const part of coords) walkCoords(part);
  };

  for (const feature of regionFeatures) walkCoords(feature.geometry.coordinates);
  for (const feature of placeFeatures) {
    const [lon, lat] = feature.geometry.coordinates;
    extend(lon, lat);
  }

  if (!Number.isFinite(minLon)) return;
  map.fitBounds(
    [
      [minLon, minLat],
      [maxLon, maxLat],
    ],
    { padding: 48, maxZoom: 7, duration: 0 },
  );
}

/**
 * Гео-карта: контур региона (line, цвет статуса) + точки places.
 */
export function GeoMapWidget() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const baseRegionsRef = useRef<GeoJsonCollection | null>(null);
  const didFitRef = useRef(false);
  const lastPlaceFeaturesRef = useRef(0);
  const [regionOutlines, setRegionOutlines] = useState(0);
  const [placeCount, setPlaceCount] = useState(0);
  const [geoError, setGeoError] = useState<string | null>(null);

  useEffect(() => {
    let map: import("maplibre-gl").Map | null = null;
    let disposed = false;
    let unsubRegions: (() => void) | undefined;
    let unsubPlaces: (() => void) | undefined;
    let lastActiveCodes = "";
    let geoReloadTimer: ReturnType<typeof setTimeout> | undefined;
    let placePopup: import("maplibre-gl").Popup | null = null;

    const activeRegionCodes = (): string =>
      [...regionsByCode$.value.values()]
        .filter((region) => region.stateLevel !== "grey")
        .map((region) => region.regionCode)
        .sort()
        .join(",");

    const fitIfNeeded = (
      regionFeatures: PolygonFeature[],
      placeFeatures: PointFeature[],
    ): void => {
      if (!map) return;
      const hadPlaces = lastPlaceFeaturesRef.current > 0;
      const hasPlaces = placeFeatures.length > 0;
      const shouldFit =
        !didFitRef.current
        || (!hadPlaces && hasPlaces);
      if (!shouldFit) return;
      if (regionFeatures.length === 0 && placeFeatures.length === 0) return;
      fitMapView(map, regionFeatures, placeFeatures);
      didFitRef.current = true;
    };

    const applyRegions = (): void => {
      if (!map || !baseRegionsRef.current) return;
      whenStyleReady(map, () => {
        if (!map || !baseRegionsRef.current) return;
        const painted = paintRegionOutlines(
          baseRegionsRef.current,
          regionsByCode$.value,
        );
        setRegionOutlines(painted.features.length);
        const source = map.getSource(REGIONS_SOURCE) as
          | import("maplibre-gl").GeoJSONSource
          | undefined;
        source?.setData(painted as never);
        const placeFeatures = placesToFeatures(placesById$.value);
        fitIfNeeded(painted.features, placeFeatures);
      });
    };

    const applyPlaces = (): void => {
      if (!map) return;
      whenStyleReady(map, () => {
        if (!map) return;
        const collection = placesCollection(placesById$.value);
        setPlaceCount(collection.features.length);
        lastPlaceFeaturesRef.current = collection.features.length;
        const source = map.getSource(PLACES_SOURCE) as
          | import("maplibre-gl").GeoJSONSource
          | undefined;
        source?.setData(collection as never);

        if (baseRegionsRef.current) {
          const painted = paintRegionOutlines(
            baseRegionsRef.current,
            regionsByCode$.value,
          );
          fitIfNeeded(painted.features, collection.features);
        }
      });
    };

    const loadRegionGeometry = (): void => {
      void mapApi
        .regionsGeoJson()
        .then((layer) => {
          if (disposed) return;
          baseRegionsRef.current = layer as GeoJsonCollection;
          setGeoError(null);
          applyRegions();
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "Ошибка загрузки геометрии";
          setGeoError(message);
          console.error("[GeoMapWidget] regions-geojson", error);
        });
    };

    const scheduleGeometryReload = (): void => {
      clearTimeout(geoReloadTimer);
      geoReloadTimer = setTimeout(() => {
        const codes = activeRegionCodes();
        if (codes === lastActiveCodes && baseRegionsRef.current) {
          applyRegions();
          return;
        }
        lastActiveCodes = codes;
        if (!codes) {
          baseRegionsRef.current = { type: "FeatureCollection", features: [] };
          applyRegions();
          return;
        }
        loadRegionGeometry();
      }, 300);
    };

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

        map.addSource(REGIONS_SOURCE, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: REGIONS_OUTLINE,
          type: "line",
          source: REGIONS_SOURCE,
          filter: ["==", ["get", "kind"], "region"],
          paint: {
            "line-color": ["coalesce", ["get", "color"], LEVEL_COLORS.grey],
            "line-width": 2.8,
            "line-opacity": 0.95,
          },
        });

        map.addSource(PLACES_SOURCE, {
          type: "geojson",
          data: placesCollection(new Map()),
        });
        map.addLayer({
          id: PLACES_LAYER,
          type: "circle",
          source: PLACES_SOURCE,
          filter: ["==", ["get", "kind"], "place"],
          paint: {
            "circle-color": ["coalesce", ["get", "color"], LEVEL_COLORS.yellow],
            "circle-radius": ["coalesce", ["get", "radius"], 9],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
            "circle-opacity": 1,
          },
        });
        if (map.getLayer(PLACES_LAYER)) {
          map.moveLayer(PLACES_LAYER);
        }

        const onPick = (event: import("maplibre-gl").MapMouseEvent): void => {
          const props = event.features?.[0]?.properties;
          const code = props?.regionCode;
          if (typeof code === "string") selectRegion(code);
        };

        const onPlaceHover = (event: import("maplibre-gl").MapMouseEvent): void => {
          if (!map) return;
          map.getCanvas().style.cursor = "pointer";
          const props = event.features?.[0]?.properties;
          const name = props?.placeName;
          if (typeof name !== "string" || !name) return;

          placePopup?.remove();
          placePopup = new maplibre.Popup({
            closeButton: false,
            closeOnClick: false,
            className: "geo-map-place-popup",
            offset: 12,
          })
            .setLngLat(event.lngLat)
            .setText(name)
            .addTo(map);
        };

        const onPlaceHoverEnd = (): void => {
          if (!map) return;
          map.getCanvas().style.cursor = "";
          placePopup?.remove();
          placePopup = null;
        };

        map.on("click", REGIONS_OUTLINE, onPick);
        map.on("click", PLACES_LAYER, onPick);
        map.on("mouseenter", PLACES_LAYER, onPlaceHover);
        map.on("mouseleave", PLACES_LAYER, onPlaceHoverEnd);

        lastActiveCodes = activeRegionCodes();
        loadRegionGeometry();
        applyPlaces();

        unsubRegions = regionsByCode$.subscribe(() => scheduleGeometryReload());
        unsubPlaces = placesById$.subscribe(() => applyPlaces());

        // Снапшот мог прийти до mount виджета — повторно кладём точки на карту.
        if (placesById$.value.size > 0) {
          map.once("idle", () => applyPlaces());
        }
      });
    })();

    return () => {
      disposed = true;
      clearTimeout(geoReloadTimer);
      placePopup?.remove();
      placePopup = null;
      unsubRegions?.();
      unsubPlaces?.();
      map?.remove();
    };
  }, []);

  return (
    <Panel title="Гео-карта" className="geo-map-panel">
      {geoError ? (
        <p className="ds-muted geo-map-panel__hint">Геометрия: {geoError}</p>
      ) : null}
      {regionOutlines === 0 && placeCount === 0 ? (
        <p className="ds-muted geo-map-panel__hint">
          Нет активных регионов/мест. Проверьте ingest и{" "}
          <code>npm run worker:reparse:raw</code>.
        </p>
      ) : (
        <p className="ds-muted geo-map-panel__hint">
          Контуров: {regionOutlines}, мест: {placeCount}
        </p>
      )}
      <div ref={containerRef} className="geo-map-panel__canvas" />
    </Panel>
  );
}
