/**
 * SSOT identity place для catalog import, upsert и plan diff.
 *
 * ОКТМО — код муниципального образования, не уникален для НП внутри МО.
 * Нельзя использовать region+oktmo без имени.
 *
 * Приоритет:
 *  1. fias_id (GUID ФИАС)
 *  2. region + oktmo + normalized name
 *  3. region + kind + normalized name (если oktmo нет)
 */

export type PlaceIdentityInput = {
  /** FIAS GUID — главный ключ, когда есть. */
  fiasId?: string | null;
  /** ОКТМО НП или МО; без имени не образует ключ. */
  oktmo?: string | null;
  /** region_id (uuid) или regionCode (stem) — скоуп субъекта. */
  regionKey: string;
  kind?: string;
  name: string;
};

/** Нормализация имени для identity (как normalizeGeoText в api). */
export function normalizePlaceIdentityName(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Детерминированный ключ dedup / plan diff. */
export function resolvePlaceIdentityKey(input: PlaceIdentityInput): string {
  const fiasId = input.fiasId?.trim();
  if (fiasId) {
    return fiasId;
  }

  const regionKey = input.regionKey.trim();
  const nameNorm = normalizePlaceIdentityName(input.name);
  const oktmo = input.oktmo?.trim();
  if (oktmo) {
    return `${regionKey}:oktmo:${oktmo}:${nameNorm}`;
  }

  const kind = input.kind?.trim() || "locality";
  return `${regionKey}:${kind}:${nameNorm}`;
}

/** Совпадение identity для upsert (без генерации ключа). */
export function placeIdentityMatches(
  existing: PlaceIdentityInput,
  incoming: PlaceIdentityInput,
): boolean {
  return resolvePlaceIdentityKey(existing) === resolvePlaceIdentityKey(incoming);
}
