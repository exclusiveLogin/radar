import type { RegionRecord } from "../ports/geo-repositories";

/**
 * Двухзначный префикс субъекта РФ из кода LLM или полного kladr_id (7300000000000 → 73).
 * Возвращает null, если строка не похожа на код субъекта.
 */
export function parseKladrSubjectPrefix(code: string): string | null {
  const trimmed = code.trim();
  if (!trimmed) return null;

  if (/^\d{13}$/.test(trimmed)) {
    return trimmed.slice(0, 2);
  }

  if (/^\d{1,2}$/.test(trimmed)) {
    return trimmed.padStart(2, "0");
  }

  return null;
}

/** Канонический код региона для карты и проекций — ISO, иначе legacy code. */
export function canonicalRegionCode(region: Pick<RegionRecord, "iso" | "code">): string {
  return region.iso ?? region.code;
}
