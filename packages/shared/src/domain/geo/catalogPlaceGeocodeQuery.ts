import type { RegionRecord } from "../../ports/geo-repositories";

const SUBJECT_TYPE_TOKENS = new Set([
  "область",
  "обл",
  "край",
  "республика",
  "респ",
  "ао",
  "округ",
]);

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

/** В строке есть явный тип субъекта РФ (область, край, …). */
export function isFederalSubjectLabel(label: string): boolean {
  const tokens = normalize(label)
    .split(/\s+/)
    .map((token) => token.replace(/\./g, ""));
  return tokens.some((token) => SUBJECT_TYPE_TOKENS.has(token));
}

/** FIAS «обл Белгородская» / «Удмуртская Респ» → полное имя для Nominatim/DaData. */
export function normalizeFederalSubjectDisplay(raw: string): string {
  const trimmed = raw.trim();
  const prefix = trimmed.match(/^(обл|область|край|респ|республика|ао)\.?\s+(.+)$/i);
  if (prefix) {
    const type = prefix[1]!.toLowerCase();
    const name = prefix[2]!.trim();
    if (type === "обл" || type === "область") return `${name} область`;
    if (type === "край") return `${name} край`;
    if (type === "респ" || type === "республика") return `${name} республика`;
    return trimmed;
  }

  const suffixResp = trimmed.match(/^(.+?)\s+респ\.?$/iu);
  if (suffixResp) return `${suffixResp[1]!.trim()} республика`;

  const suffixObl = trimmed.match(/^(.+?)\s+обл\.?$/iu);
  if (suffixObl) return `${suffixObl[1]!.trim()} область`;

  const suffixAo = trimmed.match(/^(.+?)\s+(?:ао|автономный\s+округ)\.?$/iu);
  if (suffixAo) return `${suffixAo[1]!.trim()} автономный округ`;

  return trimmed;
}

/** Полное имя субъекта для геокодера (не «Белгородская», а «Белгородская область»). */
export function formatFederalSubjectLabel(
  region: Pick<RegionRecord, "name" | "nameWithType" | "shortName">,
): string {
  for (const candidate of [region.nameWithType, region.name, region.shortName]) {
    if (!candidate?.trim()) continue;
    const normalized = normalizeFederalSubjectDisplay(candidate);
    if (isFederalSubjectLabel(normalized)) return normalized;
  }

  const base = region.name.trim();
  if (!base) return "";
  if (/(?:ская|ский|ское|ские)\s*$/iu.test(base)) return `${base} область`;
  return base;
}

export type CatalogPlaceGeocodeInput = {
  placeName: string;
  placeNameWithType?: string;
  region: Pick<RegionRecord, "name" | "nameWithType" | "shortName" | "iso">;
  parentPlaceName?: string;
  parentPlaceNameWithType?: string;
};

/** FIAS-префикс типа НП ломает Nominatim («с. X» → []), без префикса находит. */
export function stripFiasSettlementPrefix(label: string): string {
  return label
    .replace(
      /^(?:г|с|д|рп|пгт|ст-?ца|х|аул|сл|м|дп|кп|нп|п|п\.?\s*ст)\.\s+/iu,
      "",
    )
    .trim();
}

/**
 * Запрос для catalog place + region: «место[, район], субъект, страна».
 * SSOT для geoParse (job_geo_place_enrich) и ingest enrichers.
 */
export function buildCatalogPlaceGeocodeQuery(input: CatalogPlaceGeocodeInput): string {
  const placeLabel = stripFiasSettlementPrefix(
    (input.placeNameWithType ?? input.placeName).trim(),
  );
  const regionLabel = formatFederalSubjectLabel(input.region);
  if (!placeLabel) return regionLabel;
  if (!regionLabel) return placeLabel;

  const parts = [placeLabel];
  const parentLabel = stripFiasSettlementPrefix(
    (input.parentPlaceNameWithType ?? input.parentPlaceName)?.trim() ?? "",
  );
  if (parentLabel && !normalize(placeLabel).includes(normalize(parentLabel))) {
    parts.push(parentLabel);
  }
  parts.push(regionLabel, resolveGeocodeCountryLabel(input.region.iso));

  return parts.join(", ");
}

/** @deprecated alias — используй buildCatalogPlaceGeocodeQuery */
export function buildRegionScopedGeocodeQuery(placeName: string, regionName: string): string {
  return buildCatalogPlaceGeocodeQuery({
    placeName,
    region: { name: regionName },
  });
}

export function resolveGeocodeCountryLabel(iso?: string): string {
  const upper = iso?.trim().toUpperCase() ?? "";
  if (upper.startsWith("UA-")) return "Украина";
  return "Россия";
}

/** ISO3166-1 alpha2 для Nominatim countrycodes. */
export function resolveNominatimCountryCode(iso?: string): string {
  const upper = iso?.trim().toUpperCase() ?? "";
  if (upper.startsWith("UA-")) return "ua";
  return "ru";
}

export type NominatimViewbox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

/** bbox региона → viewbox Nominatim (мягкая привязка к субъекту). */
export function parseRegionViewbox(bbox: unknown): NominatimViewbox | undefined {
  if (!bbox || typeof bbox !== "object") return undefined;

  if (Array.isArray(bbox) && bbox.length === 4) {
    const [west, south, east, north] = bbox.map(Number);
    if ([west, south, east, north].every(Number.isFinite)) {
      return { west, south, east, north };
    }
    return undefined;
  }

  const box = bbox as Record<string, unknown>;
  const west = Number(box.minLon ?? box.west ?? box.min_lng);
  const east = Number(box.maxLon ?? box.east ?? box.max_lng);
  const south = Number(box.minLat ?? box.south ?? box.min_lat);
  const north = Number(box.maxLat ?? box.north ?? box.max_lat);
  if (![west, south, east, north].every(Number.isFinite)) return undefined;
  return { west, south, east, north };
}
