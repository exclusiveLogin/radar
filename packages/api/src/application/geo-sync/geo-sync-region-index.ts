import type { RegionRecord } from "@radar/shared";
import { normalizeName } from "./diff-engine";
import { regionStemKey } from "../../infrastructure/geo-providers/region-canonicalization";

/** Все внешние ключи региона для resolveRegion / индекса. */
export function collectRegionKeys(region: RegionRecord): Set<string> {
  const keys = new Set<string>([region.id, region.code, normalizeName(region.name)]);
  if (region.fiasId) keys.add(region.fiasId);
  if (region.kladrId) keys.add(region.kladrId);
  if (region.iso) keys.add(region.iso);
  if (region.nameWithType) keys.add(normalizeName(region.nameWithType));
  keys.add(regionStemKey(region.name));
  if (region.nameWithType) keys.add(regionStemKey(region.nameWithType));
  return keys;
}

/** Индекс регионов по id, iso, fias, normalized name и stem. */
export function buildRegionIndex(regions: RegionRecord[]): Map<string, RegionRecord> {
  const index = new Map<string, RegionRecord>();
  for (const region of regions) {
    for (const key of collectRegionKeys(region)) {
      index.set(key, region);
    }
  }
  return index;
}

/** Резолв региона по внешнему ключу из snapshot draft. */
export function resolveRegionFromIndex(
  index: Map<string, RegionRecord>,
  regionCode: string,
): RegionRecord | undefined {
  return (
    index.get(regionCode) ??
    index.get(normalizeName(regionCode)) ??
    index.get(regionStemKey(regionCode))
  );
}

/**
 * Перед upsert подставляет id уже существующих регионов из БД,
 * чтобы FK places.region_id не указывал на «виртуальные» randomUUID.
 */
export function alignRegionRowsWithExisting(
  regionRows: RegionRecord[],
  existingRegions: RegionRecord[],
): RegionRecord[] {
  const index = buildRegionIndex(existingRegions);
  return regionRows.map((row) => {
    const matched =
      (row.iso ? resolveRegionFromIndex(index, row.iso) : undefined) ??
      (row.fiasId ? resolveRegionFromIndex(index, row.fiasId) : undefined) ??
      resolveRegionFromIndex(index, row.code) ??
      resolveRegionFromIndex(index, row.name);
    return matched ? { ...row, id: matched.id } : row;
  });
}

/**
 * Индекс для buildPlaceRows: сначала БД, затем новые regionRows (cold start после wipe).
 * Без второй фазы после wipe placeRows пустой, хотя plan считает snapshot.
 */
export function buildRegionIndexForSnapshot(
  existingRegions: RegionRecord[],
  regionRows: RegionRecord[],
): Map<string, RegionRecord> {
  const index = buildRegionIndex(existingRegions);
  for (const row of regionRows) {
    const keys = collectRegionKeys(row);
    const alreadyKnown = [...keys].some((key) => index.has(key));
    if (alreadyKnown) continue;
    for (const key of keys) {
      index.set(key, row);
    }
  }
  return index;
}
