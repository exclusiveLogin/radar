import type {
  EventLocation,
  GeoEnrichmentArtifact,
  GeoEnrichmentFinalizer,
  GeoNode,
} from "@radar/shared";
import {
  filterRegionsByTextContext,
  findLocalityAnchorsInText,
  regionCodesEquivalent,
  resolvePlaceRegionCodeInContext,
} from "../../../domain/geo/geographicTextContext.js";
import { isChannelCityListPromo } from "../../../domain/parsing/channelCityListPromo.js";
import { KnownLocalityCatalog } from "../../../infrastructure/geo-catalog/knownLocalityCatalog.js";

type RegionCandidate = { code: string; name: string; fiasId?: string };
type PlaceKind = "district" | "city" | "locality" | "settlement";
type PlaceCandidate = {
  name: string;
  kind: PlaceKind;
  regionCode?: string;
  fiasId?: string;
  lat?: number;
  lon?: number;
  sources: string[];
};

type SourceFlags = {
  hasDadata: boolean;
  hasNominatim: boolean;
  hasLlm: boolean;
};

/** Normalizes text for stable map keys and deduplication. */
function normalize(value: string): string {
  return value.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

/** Maps place kind into public EventLocation precision. */
function toEventLocationPrecision(kind: PlaceKind): EventLocation["precision"] {
  switch (kind) {
    case "district":
      return "district";
    case "city":
      return "city";
    case "settlement":
      return "settlement";
    default:
      return "locality";
  }
}

/** Chooses finalizer source label from active provider flags. */
function resolveSourceLabel(
  flags: SourceFlags,
): GeoEnrichmentFinalizer["source"] {
  const sourceCount =
    Number(flags.hasDadata) + Number(flags.hasNominatim) + Number(flags.hasLlm);
  if (sourceCount > 1) return "multi";
  if (flags.hasDadata) return "dadata";
  if (flags.hasNominatim) return "nominatim";
  if (flags.hasLlm) return "llm";
  return "local";
}

/** Chooses EventLocation source by provider priority. */
function resolveEventLocationSource(
  flags: SourceFlags,
): EventLocation["source"] {
  if (flags.hasDadata) return "dadata";
  if (flags.hasNominatim) return "nominatim";
  if (flags.hasLlm) return "llm";
  return "db";
}

/** Derives finalizer precision from merged region/place evidence. */
function resolveFinalizerPrecision(options: {
  placesCount: number;
  regionsCount: number;
  hasCoords: boolean;
  hasLocality: boolean;
  hasDistrict: boolean;
}): GeoEnrichmentFinalizer["precision"] {
  const { placesCount, regionsCount, hasCoords, hasLocality, hasDistrict } = options;
  if (placesCount === 0 && regionsCount === 0) return "unknown";
  if (hasCoords && hasLocality) return "locality_with_coords";
  if (hasLocality) return "locality";
  if (hasDistrict) return "district";
  return "region";
}

/** Converts precision into normalized completeness ratio. */
function resolveCompleteness(
  precision: GeoEnrichmentFinalizer["precision"],
): number {
  const completenessByPrecision: Record<
    GeoEnrichmentFinalizer["precision"],
    number
  > = {
    unknown: 0,
    region: 0.25,
    district: 0.5,
    locality: 0.75,
    locality_with_coords: 1,
  };
  return completenessByPrecision[precision];
}

/** Collects region candidates from catalog, prior finalizer и LLM namespaces. */
function collectRegions(artifact: GeoEnrichmentArtifact): RegionCandidate[] {
  const regionMap = new Map<string, RegionCandidate>();
  const catalogRegions = artifact.catalog?.regions ?? [];
  const seedRegions =
    catalogRegions.length > 0 ? catalogRegions : (artifact.finalizer?.regions ?? []);

  for (const region of seedRegions) {
    regionMap.set(normalize(region.code), region);
  }

  for (const node of artifact.llm?.nodes ?? []) {
    if (node.kind !== "region" || !node.regionCode) {
      continue;
    }
    const normalizedCode = normalize(node.regionCode);
    if (regionMap.has(normalizedCode)) {
      continue;
    }
    regionMap.set(normalizedCode, {
      code: node.regionCode,
      name: node.name,
      fiasId: node.fiasId,
    });
  }

  return [...regionMap.values()];
}

/** Merges single place node into deduplicated place map. */
function mergePlace(
  placeMap: Map<string, PlaceCandidate>,
  node:
    | GeoNode
    | {
        name: string;
        kind: PlaceKind;
        regionCode?: string;
        fiasId?: string;
        lat?: number;
        lon?: number;
      },
  source: string,
): void {
  if (node.kind === "region") {
    return;
  }

  const key = normalize(node.name);
  const existing = placeMap.get(key);
  if (!existing) {
    placeMap.set(key, {
      name: node.name,
      kind: node.kind as PlaceKind,
      regionCode: node.regionCode,
      fiasId: node.fiasId,
      lat: node.lat,
      lon: node.lon,
      sources: [source],
    });
    return;
  }

  existing.sources.push(source);
  if (
    existing.name[0] === existing.name[0]?.toLowerCase() &&
    node.name[0] === node.name[0]?.toUpperCase()
  ) {
    existing.name = node.name;
  }
  const regionConflict =
    existing.regionCode
    && node.regionCode
    && !regionCodesEquivalent(existing.regionCode, node.regionCode);
  // Координаты от enricher не перезаписывают место при конфликте субъекта.
  if (node.lat !== undefined && node.lon !== undefined && !regionConflict) {
    existing.lat = node.lat;
    existing.lon = node.lon;
  }
  if (node.fiasId && !existing.fiasId) existing.fiasId = node.fiasId;
  if (node.regionCode && !existing.regionCode && !regionConflict) {
    existing.regionCode = node.regionCode;
  }
}

/** Collects and merges place candidates from all enrichment namespaces. */
function collectPlaces(artifact: GeoEnrichmentArtifact): PlaceCandidate[] {
  const placeMap = new Map<string, PlaceCandidate>();
  const catalogPlaces = artifact.catalog?.places ?? [];
  const seedPlaces =
    catalogPlaces.length > 0
      ? catalogPlaces
      : (artifact.finalizer?.places ?? []).map((place) => ({
          name: place.name,
          kind: place.kind,
          fiasId: place.fiasId,
          lat: place.lat,
          lon: place.lon,
        }));

  for (const place of seedPlaces) {
    mergePlace(placeMap, place, "catalog");
  }
  for (const node of artifact.llm?.nodes ?? []) {
    if (node.kind !== "region") {
      mergePlace(placeMap, node, "llm");
    }
  }
  for (const node of artifact.dadata?.nodes ?? []) {
    mergePlace(placeMap, node, "dadata");
  }
  for (const node of artifact.nominatim?.nodes ?? []) {
    mergePlace(placeMap, node, "nominatim");
  }
  return [...placeMap.values()];
}

/** Extracts provider presence flags from artifact namespaces. */
function resolveSourceFlags(artifact: GeoEnrichmentArtifact): SourceFlags {
  return {
    hasDadata: (artifact.dadata?.nodes.length ?? 0) > 0,
    hasNominatim: (artifact.nominatim?.nodes.length ?? 0) > 0,
    hasLlm: (artifact.llm?.nodes.length ?? 0) > 0,
  };
}

/** Builds finalizer artifact and normalized EventLocation list from namespaces. */
export function buildFinalizerResult(
  artifact: GeoEnrichmentArtifact,
  rawText = "",
): {
  finalizer: GeoEnrichmentFinalizer;
  locations: EventLocation[];
} {
  const localityCatalog = KnownLocalityCatalog.loadFromDictionaries().list();
  const anchors = findLocalityAnchorsInText(rawText, localityCatalog);
  const collected = collectRegions(artifact);
  const regions = filterRegionsByTextContext(collected, rawText, anchors);
  const places = isChannelCityListPromo(rawText) ? [] : collectPlaces(artifact);
  const multiPlaceContext = places.length > 1 || anchors.length > 1;
  const flags = resolveSourceFlags(artifact);

  const precision = resolveFinalizerPrecision({
    placesCount: places.length,
    regionsCount: regions.length,
    hasCoords: places.some((place) => place.lat !== undefined && place.lon !== undefined),
    hasLocality: places.some(
      (place) => place.kind === "city" || place.kind === "locality",
    ),
    hasDistrict: places.some((place) => place.kind === "district"),
  });
  const source = resolveSourceLabel(flags);
  const eventLocationSource = resolveEventLocationSource(flags);

  const finalizer: GeoEnrichmentFinalizer = {
    schemaVersion: 1,
    regions,
    places: places.map((place) => ({
      name: place.name,
      kind: place.kind,
      fiasId: place.fiasId,
      lat: place.lat,
      lon: place.lon,
    })),
    precision,
    completeness: resolveCompleteness(precision),
    source,
  };

  const regionLocations: EventLocation[] = regions.map((region) => ({
    regionId: "00000000-0000-0000-0000-000000000000",
    regionCode: region.code,
    regionFias: region.fiasId,
    precision: "region",
    entityKind: "region",
    source: "db",
    placeName: region.name,
  }));
  const placeLocations: EventLocation[] = [];
  for (const place of places) {
    const regionCode = resolvePlaceRegionCodeInContext({
      placeName: place.name,
      placeRegionCode: place.regionCode,
      rawText,
      anchorsInText: anchors,
      localityCatalog,
      regionsCollected: collected,
      multiPlaceContext,
    });
    if (!regionCode) {
      continue;
    }
    placeLocations.push({
      regionId: "00000000-0000-0000-0000-000000000000",
      regionCode,
      precision: toEventLocationPrecision(place.kind),
      entityKind: "place",
      source: eventLocationSource,
      placeName: place.name,
      placeFias: place.fiasId,
      lat: place.lat,
      lon: place.lon,
    });
  }

  return {
    finalizer,
    locations: [...regionLocations, ...placeLocations],
  };
}
