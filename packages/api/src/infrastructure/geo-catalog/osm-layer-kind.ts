import type { PlaceRecord } from "@radar/shared";

type GeoFeatureLayer = "subject" | "district" | "city" | "city_district" | "federal_district";

/** OSM layer → ожидаемый kind place при geometry link (lookup-hint, не identity). */
export function mapOsmLayerToExpectedKind(
  layer: GeoFeatureLayer,
): PlaceRecord["kind"] | null {
  switch (layer) {
    case "subject":
      return "region";
    case "district":
      return "district";
    case "city":
      return "city";
    case "city_district":
      return "city_district";
    case "federal_district":
      return null;
    default:
      return null;
  }
}

/** Fallback kinds при link district-полигонов к FIAS locality. */
export function geometryLinkFallbackKinds(
  layer: GeoFeatureLayer,
): PlaceRecord["kind"][] {
  const primary = mapOsmLayerToExpectedKind(layer);
  if (!primary) return [];
  if (layer === "district") {
    return [primary, "city", "locality"];
  }
  return [primary];
}
