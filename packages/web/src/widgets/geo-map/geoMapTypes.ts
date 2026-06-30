/** GeoJSON Point — маркер place (кружок на карте). */
export type PointFeature = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: Record<string, string | number>;
};

/** GeoJSON Polygon/MultiPolygon — контур региона или place-полигон района. */
export type PolygonFeature = {
  type: "Feature";
  id?: string;
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, string | number>;
};

/** Коллекция полигональных features — базовая геометрия с сервера. */
export type GeoJsonCollection = {
  type: "FeatureCollection";
  features: any[]; // расслабим тип для совместимости с MapLibre
};
