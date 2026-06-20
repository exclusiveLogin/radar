import type { MapPlaceSnapshot, MapRegionSnapshot, MapVicinityScopeSnapshot, StateLevel } from "@radar/shared";
import {
  GEO_MAP_PLACE_FILL_OPACITY,
  GEO_MAP_REGION_FILL_OPACITY,
  GEO_MAP_STROKE_FILL_RATIO,
  LEVEL_COLORS,
  LEVEL_LABELS,
  PLACE_CIRCLE_RADIUS_DEFAULT,
  PLACE_CIRCLE_RADIUS_DISTRICT,
  REGION_MAP_INSET_FACTOR,
} from "../../shared/config/mapConfig.service";
import { effectivePlaceLevel, isPlaceVisibleOnMap, isRegionVisibleOnMap } from "../../shared/state/derivations";
import { geoMapFillOpacity, geoMapStrokeOpacity } from "../../shared/utils/regionFade";
import { insetRegionGeometry } from "./regionInsetOutline";
import type { GeoJsonCollection, PointFeature, PolygonFeature } from "./geoMapTypes";

const VICINITY_RING_COLOR = "#FFD54F";
const EARTH_RADIUS_M = 6371000;

/** Точка на окружности (метры, bearing deg). */
function destinationPoint(
  lat: number,
  lon: number,
  bearingDeg: number,
  distanceM: number,
): [number, number] {
  const br = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const ang = distanceM / EARTH_RADIUS_M;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(br),
  );
  const lon2 =
    lon1
    + Math.atan2(
      Math.sin(br) * Math.sin(ang) * Math.cos(lat1),
      Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2),
    );
  return [(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
}

function circleRing(lat: number, lon: number, radiusM: number, steps = 64): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i += 1) {
    ring.push(destinationPoint(lat, lon, (360 * i) / steps, radiusM));
  }
  return ring;
}

/** Vicinity scope → polygon ring features (жёлтое кольцо). */
export function vicinityScopesToFeatures(
  scopes: Map<string, MapVicinityScopeSnapshot>,
  regions: Map<string, MapRegionSnapshot>,
  now: number,
): PolygonFeature[] {
  return [...scopes.values()]
    .filter((scope) => {
      const region = regions.get(scope.regionCode);
      return region && isRegionVisibleOnMap(region, now);
    })
    .map((scope) => ({
      type: "Feature" as const,
      geometry: {
        type: "Polygon" as const,
        coordinates: [circleRing(scope.lat, scope.lon, scope.radiusM)],
      },
      properties: {
        kind: "vicinity-scope",
        scopeId: scope.scopeId,
        regionCode: scope.regionCode,
        radiusM: scope.radiusM,
        statusEventAt: scope.statusEventAt ?? "",
        fillOpacity: geoMapFillOpacity(scope.statusEventAt, now, 0.08),
        lineOpacity: geoMapStrokeOpacity(scope.statusEventAt, now, 0.08, 0.5),
        color: VICINITY_RING_COLOR,
      },
    }));
}

export function vicinityScopesCollection(
  scopes: Map<string, MapVicinityScopeSnapshot>,
  regions: Map<string, MapRegionSnapshot>,
  now = Date.now(),
): GeoJsonCollection {
  return {
    type: "FeatureCollection",
    features: vicinityScopesToFeatures(scopes, regions, now),
  };
}

/** Виды place с полигоном района на карте. */
const DISTRICT_KINDS = new Set(["district", "city_district"]);

/** Компактный отпечаток GeoJSON — пропуск setData при неизменных properties. */
export function geoJsonFingerprint(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const collection = data as { features?: Array<{ properties?: Record<string, unknown> }> };
  const features = collection.features ?? [];
  const parts = features.map((feature) => {
    const props = feature.properties ?? {};
    return [
      props.regionCode,
      props.placeId,
      props.stateLevel,
      props.statusEventAt,
      props.fillOpacity,
      props.lineOpacity,
      props.circleOpacity,
      props.circleStrokeOpacity,
      props.color,
    ].join(":");
  });
  return `${features.length}|${parts.join(";")}`;
}

/** Контуры регионов: stateLevel и fade из снапшота. */
export function paintRegionOutlines(
  base: GeoJsonCollection,
  regions: Map<string, MapRegionSnapshot>,
  now: number,
): GeoJsonCollection {
  const features: PolygonFeature[] = [];
  for (const feature of base.features) {
    const code = String(feature.properties.regionCode ?? "");
    const region = regions.get(code);
    if (!region || !isRegionVisibleOnMap(region, now)) continue;

    const stateLevel = region.stateLevel as StateLevel;
    features.push({
      ...feature,
      properties: {
        ...feature.properties,
        regionCode: code,
        stateLevel,
        color: LEVEL_COLORS[stateLevel],
        kind: "region",
        fillOpacity: geoMapFillOpacity(
          region.statusEventAt,
          now,
          GEO_MAP_REGION_FILL_OPACITY,
        ),
        lineOpacity: geoMapStrokeOpacity(
          region.statusEventAt,
          now,
          GEO_MAP_REGION_FILL_OPACITY,
          GEO_MAP_STROKE_FILL_RATIO,
        ),
      },
    });
  }
  return { type: "FeatureCollection", features };
}

/** Inset-контур для line-слоя (строго внутри полигона). */
export function paintRegionInsetOutlines(painted: GeoJsonCollection): GeoJsonCollection {
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

/** Точки places: маркер-кружок с fade по statusEventAt. */
export function placesToFeatures(
  places: Map<string, MapPlaceSnapshot>,
  regions: Map<string, MapRegionSnapshot>,
  now: number,
): PointFeature[] {
  return [...places.values()]
    .filter((place) => isPlaceVisibleOnMap(place, regions, now))
    .map((place) => {
      const regionLevel = regions.get(place.regionCode)?.stateLevel ?? "grey";
      const level = effectivePlaceLevel(place.stateLevel, regionLevel);
      return {
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
          statusEventAt: place.statusEventAt ?? "",
          stateLabel: LEVEL_LABELS[level],
          color: LEVEL_COLORS[level],
          circleOpacity: geoMapFillOpacity(
            place.statusEventAt,
            now,
            GEO_MAP_PLACE_FILL_OPACITY,
          ),
          circleStrokeOpacity: geoMapStrokeOpacity(
            place.statusEventAt,
            now,
            GEO_MAP_PLACE_FILL_OPACITY,
            GEO_MAP_STROKE_FILL_RATIO,
          ),
          radius: DISTRICT_KINDS.has(place.kind ?? "")
            ? PLACE_CIRCLE_RADIUS_DISTRICT
            : PLACE_CIRCLE_RADIUS_DEFAULT,
        },
      };
    });
}

export function placesCollection(
  places: Map<string, MapPlaceSnapshot>,
  regions: Map<string, MapRegionSnapshot>,
  now = Date.now(),
) {
  return {
    type: "FeatureCollection" as const,
    features: placesToFeatures(places, regions, now),
  };
}

/** Активные place-полигоны: join geo_feature base + placesById$. */
export function paintActiveDistricts(
  base: GeoJsonCollection,
  places: Map<string, MapPlaceSnapshot>,
  regions: Map<string, MapRegionSnapshot>,
  now: number,
): GeoJsonCollection {
  const byGeoFeatureId = new Map<string, MapPlaceSnapshot>();
  for (const place of places.values()) {
    if (place.geoFeatureId && isPlaceVisibleOnMap(place, regions, now)) {
      byGeoFeatureId.set(place.geoFeatureId, place);
    }
  }

  const features: PolygonFeature[] = [];
  for (const feature of base.features) {
    const featureId = String(feature.id ?? feature.properties.geoFeatureId ?? "");
    const place = byGeoFeatureId.get(featureId);
    if (!place) continue;

    const regionLevel = regions.get(place.regionCode)?.stateLevel ?? "grey";
    const level = effectivePlaceLevel(place.stateLevel, regionLevel);
    features.push({
      ...feature,
      properties: {
        ...feature.properties,
        kind: "place",
        color: LEVEL_COLORS[level],
        placeId: place.placeId,
        placeName: place.placeName,
        regionCode: place.regionCode,
        statusCode: place.statusCode,
        statusEventAt: place.statusEventAt ?? "",
        stateLabel: LEVEL_LABELS[level],
        fillOpacity: geoMapFillOpacity(
          place.statusEventAt,
          now,
          GEO_MAP_PLACE_FILL_OPACITY,
        ),
        lineOpacity: geoMapStrokeOpacity(
          place.statusEventAt,
          now,
          GEO_MAP_PLACE_FILL_OPACITY,
          GEO_MAP_STROKE_FILL_RATIO,
        ),
      },
    });
  }
  return { type: "FeatureCollection", features };
}
