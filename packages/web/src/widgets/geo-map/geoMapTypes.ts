import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Point,
  Polygon,
} from "geojson";

type GeoMapProperties = Record<string, string | number | boolean | null>;

/** GeoJSON Point — маркер place (кружок на карте). */
export type PointFeature = Feature<Point, GeoMapProperties>;

/** GeoJSON Polygon/MultiPolygon — контур региона или place-полигон района. */
export type PolygonFeature = Feature<Polygon | MultiPolygon, GeoMapProperties>;

/** Коллекция полигональных features — базовая геометрия с сервера. */
export type GeoJsonCollection<
  Geometry extends Point | Polygon | MultiPolygon = Polygon | MultiPolygon,
> = FeatureCollection<Geometry, GeoMapProperties>;
