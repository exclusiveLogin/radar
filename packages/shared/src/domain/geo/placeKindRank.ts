import type { PlaceRecord } from "../../ports/geo-repositories.js";

const KIND_RANK: Record<PlaceRecord["kind"], number> = {
  region: 100,
  district: 80,
  mo_go: 80,
  urban_okrug: 75,
  city_district: 70,
  city: 60,
  locality: 40,
  settlement: 30,
};

export function placeKindRank(kind: PlaceRecord["kind"]): number {
  return KIND_RANK[kind] ?? 0;
}

export function kindMeetsFloor(
  kind: PlaceRecord["kind"],
  minKind: PlaceRecord["kind"],
): boolean {
  return placeKindRank(kind) >= placeKindRank(minKind);
}

/** Минимальный kind для nominatim/geo enrich (SSOT для SQL pull-batch). */
export const GEO_ENRICH_MIN_KIND: PlaceRecord["kind"] = "city";

/** Kinds с rank ≥ city, кроме region — eligible для geo enrich queue. */
export const GEO_ENRICH_ELIGIBLE_KINDS = (
  Object.keys(KIND_RANK) as PlaceRecord["kind"][]
).filter((kind) => kind !== "region" && kindMeetsFloor(kind, GEO_ENRICH_MIN_KIND));

export function isGeoEnrichEligibleKind(kind: PlaceRecord["kind"]): boolean {
  return kindMeetsFloor(kind, GEO_ENRICH_MIN_KIND);
}

/** Стабильная сортировка omonim hits (ADR-012 §2.1). */
export function sortPlaceScanEntriesStable<T extends { regionIso: string; placeId: string }>(
  entries: T[],
): T[] {
  return [...entries].sort((a, b) => {
    const iso = a.regionIso.localeCompare(b.regionIso);
    if (iso !== 0) return iso;
    return a.placeId.localeCompare(b.placeId);
  });
}
