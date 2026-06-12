import type { MapPlaceSnapshot, MapRegionSnapshot, StateLevel } from "@radar/shared";
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
    if (!region || !isRegionVisibleOnMap(region)) continue;

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
    .filter((place) => isPlaceVisibleOnMap(place, regions))
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
    if (place.geoFeatureId && isPlaceVisibleOnMap(place, regions)) {
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
