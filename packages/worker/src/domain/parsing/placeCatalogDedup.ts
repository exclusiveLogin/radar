import type { PlaceRecord } from "@radar/shared";
import { isVendorCatalogPlace } from "./placeCatalogHealRule.js";

/** Тот же ключ, что name_normalized в БД (TypeORM repo). */
export function normalizePlaceDedupKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function placeDedupGroupKey(place: Pick<PlaceRecord, "regionId" | "name">): string {
  return `${place.regionId}\0${normalizePlaceDedupKey(place.name)}`;
}

/**
 * Канон в группе дублей: vendor → FIAS → trust → coords → evidence.
 * Tie-break: меньший uuid (детерминизм).
 */
export function pickCanonicalPlace(candidates: PlaceRecord[]): PlaceRecord {
  return [...candidates].sort((left, right) => {
    const scoreDelta = canonicalPlaceScore(right) - canonicalPlaceScore(left);
    if (scoreDelta !== 0) return scoreDelta;
    return left.id.localeCompare(right.id);
  })[0]!;
}

function canonicalPlaceScore(place: PlaceRecord): number {
  let score = 0;
  if (isVendorCatalogPlace(place)) score += 1_000;
  if (place.fiasId) score += 500;
  if (place.isTrusted) score += 100;
  if (place.trustState === "verified") score += 50;
  if (place.centroidLat != null && place.centroidLon != null) score += 25;
  score += (place.evidenceProviders?.length ?? 0) * 10;
  if (place.trustScore != null) score += place.trustScore * 10;
  return score;
}

/** Active non-region places, сгруппированные по region + normalized name (>1 в группе). */
export function findActivePlaceDuplicateGroups(
  places: PlaceRecord[],
): Map<string, PlaceRecord[]> {
  const buckets = new Map<string, PlaceRecord[]>();
  for (const place of places) {
    if (place.kind === "region") continue;
    const key = placeDedupGroupKey(place);
    const group = buckets.get(key) ?? [];
    group.push(place);
    buckets.set(key, group);
  }

  const duplicates = new Map<string, PlaceRecord[]>();
  for (const [key, group] of buckets) {
    if (group.length > 1) {
      duplicates.set(key, group);
    }
  }
  return duplicates;
}
