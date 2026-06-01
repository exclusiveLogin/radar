import type { LocationCandidate } from "@radar/shared";

/** Поля `data` ответа suggest/address (DaData 4_1). */
export type DadataAddressData = Record<string, unknown>;

export type DadataSuggestion = {
  value?: string;
  data?: DadataAddressData;
};

/**
 * Маппинг DaData → LocationCandidate: только гео-поля (coords, fias, населённый пункт).
 * Регион: hint из catalog/якоря, иначе region_iso_code если есть в ответе.
 */
export function mapDadataSuggestion(
  best: DadataSuggestion,
  input: { queryNorm: string; regionCodeHint?: string },
): LocationCandidate | null {
  const data = best.data;
  if (!data) return null;

  const latRaw = data.geo_lat;
  const lonRaw = data.geo_lon;
  const lat = latRaw != null && latRaw !== "" ? Number(latRaw) : undefined;
  const lon = lonRaw != null && lonRaw !== "" ? Number(lonRaw) : undefined;

  const placeName = pickPlaceName(data, best.value);
  const regionCode =
    input.regionCodeHint?.trim()
    || pickString(data, "region_iso_code")
    || pickString(data, "region_kladr_id")
    || "";

  const placeFias =
    pickString(data, "fias_id")
    || pickString(data, "city_fias_id")
    || pickString(data, "settlement_fias_id");

  return {
    provider: "dadata",
    queryNorm: input.queryNorm,
    regionCode,
    placeName,
    placeFias: placeFias || undefined,
    lat: Number.isFinite(lat) ? lat : undefined,
    lon: Number.isFinite(lon) ? lon : undefined,
    raw: data,
  };
}

function pickString(data: DadataAddressData, key: string): string {
  const value = data[key];
  if (value == null || value === "") return "";
  return String(value).trim();
}

/** Населённый пункт из структурированных полей DaData (не вся строка value). */
function pickPlaceName(data: DadataAddressData, value?: string): string {
  const structured =
    pickString(data, "settlement")
    || pickString(data, "city")
    || pickString(data, "area")
    || pickString(data, "region");
  if (structured) return structured;
  return String(value ?? "").trim();
}
