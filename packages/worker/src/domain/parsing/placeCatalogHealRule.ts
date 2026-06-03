import type { PlaceRecord } from "@radar/shared";
import { isGarbageIngestPlaceName } from "./channelCityListPromo.js";

/** Область прогона catalog heal. */
export type PlaceCatalogHealScope = "candidates" | "all";

/**
 * Vendor-каталог (geo:db:apply): verified + revision — не трогаем healer'ом.
 */
export function isVendorCatalogPlace(place: PlaceRecord): boolean {
  return Boolean(
    place.lastSourceRevision
      && place.trustState === "verified"
      && place.isTrusted,
  );
}

/**
 * Place подлежит прогону через GeoValidationService в catalog heal.
 * region-place (kind=region) и vendor-каталог исключаются всегда.
 */
export function isPlaceCatalogHealCandidate(
  place: PlaceRecord,
  scope: PlaceCatalogHealScope = "candidates",
): boolean {
  if (place.kind === "region") {
    return false;
  }
  if (isVendorCatalogPlace(place)) {
    return false;
  }
  if (scope === "all") {
    return true;
  }

  if (isGarbageIngestPlaceName(place.name)) {
    return true;
  }
  if (place.trustState === "rejected") {
    return true;
  }
  if (!place.isTrusted && !place.fiasId) {
    return true;
  }
  const providers = place.evidenceProviders ?? [];
  if (providers.length === 1 && providers[0] === "llm") {
    return true;
  }

  return false;
}
