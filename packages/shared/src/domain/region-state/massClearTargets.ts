/** Запись каталога регионов для парсинга группового отбоя из текста. */
export type MassClearRegionRef = {
  id: string;
  iso: string | null;
  name: string;
  nameWithType: string | null;
  shortName: string | null;
};

/** Нормализация текста для поиска названий субъектов в raw_message. */
export function normalizeClearHaystack(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[!?.:;()[\]{}«»"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Групповой отбой: регионы, чьи имена встречаются в тексте после «отбой» и «:».
 * SSOT — эквивалент resolveClearTargets в LastWinnerReadModelProjection.
 */
export function resolveMassClearTargets(
  rawText: string,
  regions: MassClearRegionRef[],
): Array<{ regionId: string; regionCode: string }> {
  if (!rawText) return [];
  if (!/отбой/i.test(rawText) || !/:/.test(rawText)) {
    return [];
  }

  const haystack = normalizeClearHaystack(rawText);
  const hits: Array<{ regionId: string; regionCode: string }> = [];

  for (const region of regions) {
    const variants = [region.name, region.nameWithType ?? "", region.shortName ?? ""]
      .map((value) => normalizeClearHaystack(value))
      .filter(Boolean);
    if (variants.some((variant) => haystack.includes(variant))) {
      hits.push({
        regionId: region.id,
        regionCode: region.iso ?? region.name,
      });
    }
  }

  return hits;
}

/** Массовый разбор текста только для cleared с не более чем одной region-локацией. */
export function isMassClearTextEligible(
  eventType: string,
  nonPlaceLocationCount: number,
): boolean {
  return eventType === "cleared" && nonPlaceLocationCount <= 1;
}
