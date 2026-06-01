import { useEffect, useRef, useState } from "react";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapLayerMouseEvent,
  Popup,
} from "maplibre-gl";
import type { Subscription } from "rxjs";
import type { MapPlaceSnapshot, MapRegionSnapshot, StateLevel } from "@radar/shared";
import { Panel } from "../../shared/ds";
import { mapApi } from "../../shared/api/mapApi";
import {
  LEVEL_COLORS,
  LEVEL_LABELS,
  MAP_INITIAL_VIEW,
  REGION_MAP_FILL_OPACITY,
  REGION_MAP_INSET_FACTOR,
  REGION_MAP_STROKE_WIDTH,
  resolveMapBasemapStyle,
} from "../../shared/config/mapConfig.service";
import { placesById$, regionsByCode$ } from "../../shared/state/mapStore";
import { selectRegion } from "../../shared/state/selectionStore";
import type { WidgetProps } from "../widgetProps";
import { insetRegionGeometry } from "./regionInsetOutline";

const REGIONS_SOURCE = "regions";
const REGIONS_OUTLINE_SOURCE = "regions-outline-inset";
const REGIONS_FILL = "regions-fill";
const REGIONS_OUTLINE = "regions-outline";
const PLACES_SOURCE = "places";
const PLACES_LAYER = "places-circles";

/** Place-слой выше fill региона — при hover на точку не показываем тултип области. */
function hasPlaceAtPointer(map: MapLibreMap, point: { x: number; y: number }): boolean {
  return map.queryRenderedFeatures(point, { layers: [PLACES_LAYER] }).length > 0;
}

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
 * Контуры регионов: все уровни, включая grey; цвет по stateLevel из снапшота.
 * Базовая геометрия загружается один раз; при WS меняются только properties.
 */
function paintRegionOutlines(
  base: GeoJsonCollection,
  regions: Map<string, MapRegionSnapshot>,
): GeoJsonCollection {
  return {
    type: "FeatureCollection",
    features: base.features.map((feature): PolygonFeature => {
      const code = String(feature.properties.regionCode ?? "");
      const region = regions.get(code);
      const stateLevel = (region?.stateLevel ?? "grey") as StateLevel;
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
    }),
  };
}

/** Line-слой: inset-контур (строго внутри полигона, без line-offset). */
function paintRegionInsetOutlines(
  painted: GeoJsonCollection,
): GeoJsonCollection {
  return {
    type: "FeatureCollection",
    features: painted.features.map((feature) => ({
      ...feature,
      geometry: insetRegionGeometry(
        feature.geometry as { type: string; coordinates: unknown },
        REGION_MAP_INSET_FACTOR,
      ) as PolygonFeature["geometry"],
    })),
  };
}

/** Точки places: не показываем в регионах без оперативного уровня (grey). */
function placesToFeatures(
  places: Map<string, MapPlaceSnapshot>,
  regions: Map<string, MapRegionSnapshot>,
): PointFeature[] {
  return [...places.values()]
    .filter((place) => regions.get(place.regionCode)?.stateLevel !== "grey")
    .map((place) => ({
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
        statusCode: place.statusCode,
        stateLabel: LEVEL_LABELS[place.stateLevel],
        color: LEVEL_COLORS[place.stateLevel],
        radius: 9,
      },
    }));
}

/** Выполняет fn, когда стиль MapLibre готов (иначе setData теряется). */
function whenStyleReady(
  map: MapLibreMap,
  fn: () => void,
): void {
  if (map.isStyleLoaded()) {
    fn();
    return;
  }
  map.once("load", fn);
}

function placesCollection(
  places: Map<string, MapPlaceSnapshot>,
  regions: Map<string, MapRegionSnapshot>,
) {
  return {
    type: "FeatureCollection" as const,
    features: placesToFeatures(places, regions),
  };
}

function fitMapView(
  map: MapLibreMap,
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
 * Гео-карта: заливка + внутренний контур региона (цвет stateLevel) + точки places.
 */
export function GeoMapWidget(_props: WidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const baseRegionsRef = useRef<GeoJsonCollection | null>(null);
  const didFitRef = useRef(false);
  const lastPlaceFeaturesRef = useRef(0);
  const [regionOutlines, setRegionOutlines] = useState(0);
  const [placeCount, setPlaceCount] = useState(0);
  const [geoError, setGeoError] = useState<string | null>(null);

  useEffect(() => {
    let map: MapLibreMap | null = null;
    let disposed = false;
    let unsubRegions: Subscription | undefined;
    let unsubPlaces: Subscription | undefined;
    let geoReloadTimer: ReturnType<typeof setTimeout> | undefined;
    let placePopup: Popup | null = null;
    let regionPopup: Popup | null = null;

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
        const fillSource = map.getSource(REGIONS_SOURCE) as
          | GeoJSONSource
          | undefined;
        fillSource?.setData(painted as never);
        const outlineSource = map.getSource(REGIONS_OUTLINE_SOURCE) as
          | GeoJSONSource
          | undefined;
        outlineSource?.setData(paintRegionInsetOutlines(painted) as never);
        const placeFeatures = placesToFeatures(
          placesById$.value,
          regionsByCode$.value,
        );
        fitIfNeeded(painted.features, placeFeatures);
      });
    };

    const applyPlaces = (): void => {
      if (!map) return;
      whenStyleReady(map, () => {
        if (!map) return;
        const collection = placesCollection(
          placesById$.value,
          regionsByCode$.value,
        );
        setPlaceCount(collection.features.length);
        lastPlaceFeaturesRef.current = collection.features.length;
        const source = map.getSource(PLACES_SOURCE) as
          | GeoJSONSource
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

    const scheduleMapRefresh = (): void => {
      clearTimeout(geoReloadTimer);
      geoReloadTimer = setTimeout(() => {
        if (baseRegionsRef.current) {
          applyRegions();
          applyPlaces();
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
        map.addSource(REGIONS_OUTLINE_SOURCE, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: REGIONS_FILL,
          type: "fill",
          source: REGIONS_SOURCE,
          filter: ["==", ["get", "kind"], "region"],
          paint: {
            "fill-color": ["coalesce", ["get", "color"], LEVEL_COLORS.grey],
            "fill-opacity": REGION_MAP_FILL_OPACITY,
          },
        });
        map.addLayer({
          id: REGIONS_OUTLINE,
          type: "line",
          source: REGIONS_OUTLINE_SOURCE,
          filter: ["==", ["get", "kind"], "region"],
          paint: {
            "line-color": ["coalesce", ["get", "color"], LEVEL_COLORS.grey],
            "line-width": REGION_MAP_STROKE_WIDTH,
            "line-opacity": 0.95,
          },
        });

        map.addSource(PLACES_SOURCE, {
          type: "geojson",
          data: placesCollection(new Map(), new Map()),
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

        const onPick = (event: MapLayerMouseEvent): void => {
          const props = event.features?.[0]?.properties;
          const code = props?.regionCode;
          if (typeof code === "string") selectRegion(code);
        };

        const onPlaceHover = (event: MapLayerMouseEvent): void => {
          if (!map) return;
          regionPopup?.remove();
          regionPopup = null;
          map.getCanvas().style.cursor = "pointer";
          const props = event.features?.[0]?.properties;
          const name = props?.placeName;
          if (typeof name !== "string" || !name) return;

          const regionCode = props?.regionCode;
          const stateLabel = props?.stateLabel;
          const statusCode = props?.statusCode;
          const lines = [
            name,
            typeof regionCode === "string" ? regionCode : null,
            typeof stateLabel === "string" ? stateLabel : null,
            typeof statusCode === "string" ? statusCode : null,
          ].filter(Boolean);

          placePopup?.remove();
          placePopup = new maplibre.Popup({
            closeButton: false,
            closeOnClick: false,
            className: "geo-map-place-popup",
            offset: 12,
          })
            .setLngLat(event.lngLat)
            .setText(lines.join("\n"))
            .addTo(map);
        };

        const onPlaceHoverEnd = (): void => {
          if (!map) return;
          map.getCanvas().style.cursor = "";
          placePopup?.remove();
          placePopup = null;
        };

        const onRegionHover = (event: MapLayerMouseEvent): void => {
          if (!map) return;
          if (hasPlaceAtPointer(map, event.point)) {
            regionPopup?.remove();
            regionPopup = null;
            return;
          }
          map.getCanvas().style.cursor = "pointer";
          const code = event.features?.[0]?.properties?.regionCode;
          if (typeof code !== "string" || !code) return;

          const region = regionsByCode$.value.get(code);
          const lines = [
            `${code} — ${region?.name ?? code}`,
            region ? `${LEVEL_LABELS[region.stateLevel]} · ×${region.activity}` : null,
          ].filter(Boolean);

          regionPopup?.remove();
          regionPopup = new maplibre.Popup({
            closeButton: false,
            closeOnClick: false,
            className: "geo-map-region-popup",
            offset: 12,
          })
            .setLngLat(event.lngLat)
            .setText(lines.join("\n"))
            .addTo(map);
        };

        const onRegionHoverEnd = (): void => {
          if (!map) return;
          map.getCanvas().style.cursor = "";
          regionPopup?.remove();
          regionPopup = null;
        };

        map.on("click", REGIONS_FILL, onPick);
        map.on("click", REGIONS_OUTLINE, onPick);
        map.on("click", PLACES_LAYER, onPick);
        map.on("mouseenter", PLACES_LAYER, onPlaceHover);
        map.on("mousemove", PLACES_LAYER, onPlaceHover);
        map.on("mouseleave", PLACES_LAYER, onPlaceHoverEnd);
        map.on("mousemove", REGIONS_FILL, onRegionHover);
        map.on("mouseleave", REGIONS_FILL, onRegionHoverEnd);

        loadRegionGeometry();
        applyPlaces();

        unsubRegions = regionsByCode$.subscribe(() => scheduleMapRefresh());
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
      regionPopup?.remove();
      regionPopup = null;
      unsubRegions?.unsubscribe();
      unsubPlaces?.unsubscribe();
      map?.remove();
    };
  }, []);

  return (
    <Panel variant="bare" className="geo-map-panel">
      {!geoError && (regionOutlines > 0 || placeCount > 0) && (
        <div className="geo-map-panel__stats">
          Контуров: {regionOutlines} · мест: {placeCount}
        </div>
      )}
      {geoError && (
        <div className="geo-map-panel__stats">Геометрия: {geoError}</div>
      )}
      {regionOutlines === 0 && placeCount === 0 && !geoError && (
        <div className="geo-map-panel__stats">
          Нет активных регионов/мест
        </div>
      )}
      <div ref={containerRef} className="geo-map-panel__canvas" />
    </Panel>
  );
}
