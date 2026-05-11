import type { EventLocation, GeoEnrichmentFinalizer, GeoNode } from "@radar/shared";
import type { GeoPipelineContext, GeoPipelineStep } from "../GeoPipelineContext.js";

function normalize(name: string): string {
  return name.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

function resolveSourceLabel(options: {
  hasDadata: boolean;
  hasNominatim: boolean;
  hasLlm: boolean;
}): GeoEnrichmentFinalizer["source"] {
  const { hasDadata, hasNominatim, hasLlm } = options;
  const sourceCount = Number(hasDadata) + Number(hasNominatim) + Number(hasLlm);
  if (sourceCount > 1) return "multi";
  if (hasDadata) return "dadata";
  if (hasNominatim) return "nominatim";
  if (hasLlm) return "llm";
  return "local";
}

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

function toEventLocationPrecision(
  kind: "district" | "city" | "locality" | "settlement",
): EventLocation["precision"] {
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

function resolveEventLocationSource(options: {
  hasDadata: boolean;
  hasNominatim: boolean;
  hasLlm: boolean;
}): EventLocation["source"] {
  const { hasDadata, hasNominatim, hasLlm } = options;
  if (hasDadata) return "dadata";
  if (hasNominatim) return "nominatim";
  if (hasLlm) return "llm";
  return "db";
}

/**
 * Merges all namespace nodes into a deduplicated flat list of EventLocations,
 * then writes `artifact.finalizer` and populates `ctx.locations`.
 *
 * Priority for coordinates: dadata > nominatim > catalog.
 */
export class FinalizerStep implements GeoPipelineStep {
  readonly id = "finalizer";

  constructor(private readonly locations: EventLocation[]) {}

  run(ctx: GeoPipelineContext): Promise<void> {
    const { catalog, llm, dadata, nominatim } = ctx.artifact;

    // ── 1. Collect candidate regions ──────────────────────────────────────
    const regionMap = new Map<string, { code: string; name: string; fiasId?: string }>();

    for (const r of catalog?.regions ?? []) {
      regionMap.set(normalize(r.code), r);
    }
    for (const n of llm?.nodes ?? []) {
      if (n.kind === "region" && n.regionCode) {
        if (!regionMap.has(normalize(n.regionCode))) {
          regionMap.set(normalize(n.regionCode), {
            code: n.regionCode,
            name: n.name,
            fiasId: n.fiasId,
          });
        }
      }
    }

    // ── 2. Collect place candidates from all namespaces ────────────────────
    type PlaceCandidate = {
      name: string;
      kind: "district" | "city" | "locality" | "settlement";
      regionCode?: string;
      fiasId?: string;
      lat?: number;
      lon?: number;
      sources: string[];
    };

    const placesByNorm = new Map<string, PlaceCandidate>();

    const addPlace = (node: GeoNode | { name: string; kind: "district" | "city" | "locality" | "settlement"; regionCode?: string; fiasId?: string; lat?: number; lon?: number }, source: string) => {
      if (node.kind === "region") return;
      const key = normalize(node.name);
      const existing = placesByNorm.get(key);
      if (!existing) {
        placesByNorm.set(key, {
          name: node.name,
          kind: node.kind as PlaceCandidate["kind"],
          regionCode: node.regionCode,
          fiasId: node.fiasId,
          lat: node.lat,
          lon: node.lon,
          sources: [source],
        });
      } else {
        existing.sources.push(source);
        // Prefer better-cased name: if existing is all-lowercase and new starts uppercase → update.
        if (
          existing.name[0] === existing.name[0]?.toLowerCase() &&
          node.name[0] === node.name[0]?.toUpperCase()
        ) {
          existing.name = node.name;
        }
        if (node.lat !== undefined && node.lon !== undefined) {
          existing.lat = node.lat;
          existing.lon = node.lon;
        }
        if (node.fiasId && !existing.fiasId) existing.fiasId = node.fiasId;
        if (node.regionCode && !existing.regionCode) existing.regionCode = node.regionCode;
      }
    };

    for (const p of catalog?.places ?? []) addPlace(p, "catalog");
    for (const n of llm?.nodes ?? []) if (n.kind !== "region") addPlace(n, "llm");
    for (const n of dadata?.nodes ?? []) addPlace(n, "dadata");
    for (const n of nominatim?.nodes ?? []) addPlace(n, "nominatim");

    // ── 3. Determine best source label ────────────────────────────────────
    const hasDadata = (dadata?.nodes.length ?? 0) > 0;
    const hasNominatim = (nominatim?.nodes.length ?? 0) > 0;
    const hasLlm = (llm?.nodes.length ?? 0) > 0;
    const sourceLabel = resolveSourceLabel({ hasDadata, hasNominatim, hasLlm });
    const eventLocationSource = resolveEventLocationSource({
      hasDadata,
      hasNominatim,
      hasLlm,
    });

    const places = [...placesByNorm.values()];
    const regions = [...regionMap.values()];

    // ── 4. Derive precision / completeness ────────────────────────────────
    const hasCoords = places.some((p) => p.lat !== undefined && p.lon !== undefined);
    const hasLocality = places.some((p) => p.kind === "city" || p.kind === "locality");
    const hasDistrict = places.some((p) => p.kind === "district");
    const precision = resolveFinalizerPrecision({
      placesCount: places.length,
      regionsCount: regions.length,
      hasCoords,
      hasLocality,
      hasDistrict,
    });

    const completeness =
      precision === "locality_with_coords"
        ? 1
        : precision === "locality"
          ? 0.75
          : precision === "district"
            ? 0.5
            : precision === "region"
              ? 0.25
              : 0;

    ctx.artifact.finalizer = {
      schemaVersion: 1,
      regions,
      places: places.map((p) => ({
        name: p.name,
        kind: p.kind,
        fiasId: p.fiasId,
        lat: p.lat,
        lon: p.lon,
      })),
      precision,
      completeness,
      source: sourceLabel,
    };

    // ── 5. Build EventLocation[] ──────────────────────────────────────────
    const primaryRegionCode = regions[0]?.code ?? "unknown";

    // region entries
    for (const r of regions) {
      this.locations.push({
        regionId: "00000000-0000-0000-0000-000000000000",
        regionCode: r.code,
        regionFias: r.fiasId,
        precision: "region",
        source: "db",
        placeName: r.name,
      });
    }

    // place entries
    for (const p of places) {
      this.locations.push({
        regionId: "00000000-0000-0000-0000-000000000000",
        regionCode: p.regionCode ?? primaryRegionCode,
        precision: toEventLocationPrecision(p.kind),
        source: eventLocationSource,
        placeName: p.name,
        placeFias: p.fiasId,
        lat: p.lat,
        lon: p.lon,
      });
    }

    return Promise.resolve();
  }
}
