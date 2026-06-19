import type { GeoCatalog, RegionCatalogEntry } from "../infrastructure/geo-catalog/index.js";

/** Нормализованная локация для сравнения replay vs БД. */
export type NormalizedLocation = {
  regionCode: string;
  placeName: string | null;
  precision: string;
  source: string;
};

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Приводит регион (код/ISO/имя) к каноническому 2-значному коду каталога. */
export function canonicalRegionCode(
  catalog: GeoCatalog,
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (catalog.getRegionByCode(trimmed)) return trimmed;

  const isoMatch = trimmed.match(/^ru-(.+)$/i);
  if (isoMatch?.[1] && catalog.getRegionByCode(isoMatch[1])) return isoMatch[1];

  const normalized = normalizeName(trimmed);
  const byName = catalog
    .listRegions()
    .find(
      (entry: RegionCatalogEntry) =>
        normalizeName(entry.name) === normalized ||
        entry.aliases.includes(normalized),
    );
  return byName?.code ?? trimmed;
}

export function normalizePlaceName(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = normalizeName(value);
  return normalized.length > 0 ? normalized : null;
}
